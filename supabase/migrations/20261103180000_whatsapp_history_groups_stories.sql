-- =============================================================================
-- Histórico e grupos do WhatsApp por QR Code, e stories no Conteúdo
-- =============================================================================
--   * Conversa passa a ter tipo: contato (com telefone) ou grupo (com id do grupo).
--     Grupo pode ser ligado a um cliente, e nunca entra em automação, radar ou cadência.
--   * Histórico importado não dispara automação, notificação nem conta nos indicadores:
--     o que já aconteceu no aparelho não é atendimento novo.
--   * whatsapp_imports guarda o andamento, para continuar depois de fechar a tela.
--   * Conteúdo ganha o formato stories.
-- =============================================================================

alter table public.content_items drop constraint content_items_format_check;
alter table public.content_items add constraint content_items_format_check check (format in ('post', 'video', 'reels', 'stories'));

alter table public.conversations
  add column kind text not null default 'contato' check (kind in ('contato', 'grupo')),
  add column group_jid text check (group_jid ~ '^[0-9-]+@g\.us$'),
  add column client_id uuid references public.clients (id) on delete set null,
  add column imported_at timestamptz,
  add column only_history boolean generated always as (coalesce(imported_at >= last_message_at, false)) stored,
  alter column contact_e164 drop not null,
  add constraint conversations_kind_ck check (
    (kind = 'contato' and contact_e164 is not null and group_jid is null)
    or (kind = 'grupo' and group_jid is not null and contact_e164 is null)
  );
create unique index conversations_group_uq on public.conversations (number_id, group_jid) where group_jid is not null;
create index conversations_client_idx on public.conversations (client_id) where client_id is not null;
create index conversations_kind_idx on public.conversations (organization_id, kind, last_message_at desc);

alter table public.messages
  add column sender_name text check (char_length(sender_name) <= 120),
  add column sender_jid text check (char_length(sender_jid) <= 120),
  add column imported boolean not null default false;

-- Quem escreve em grupo aparece na lista, como no WhatsApp.
drop function public.conversation_previews(uuid[]);
create function public.conversation_previews(p_ids uuid[])
returns table (conversation_id uuid, direction text, type text, body text, media_name text, status text, created_at timestamptz, sender_name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, m.direction, m.type, left(m.body, 200), m.media_name, m.status, m.created_at, m.sender_name
    from unnest(p_ids) as c(id)
    cross join lateral (
      select x.direction, x.type, x.body, x.media_name, x.status, x.created_at, x.sender_name
        from public.messages x
       where x.conversation_id = c.id and x.direction <> 'nota'
       order by x.created_at desc limit 1
    ) m;
$$;
revoke execute on function public.conversation_previews(uuid[]) from public, anon;
grant execute on function public.conversation_previews(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Gatilhos: importação fica de fora; grupo não gera evento de automação
-- -----------------------------------------------------------------------------
create or replace function private.hub_event_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead uuid;
  v_kind text;
begin
  if new.direction = 'entrada' and coalesce(current_setting('hub.importing', true), '') <> 'on' then
    select lead_id, kind into v_lead, v_kind from public.conversations where id = new.conversation_id;
    if v_kind = 'contato' then
      perform private.emit_hub_event(new.organization_id, 'mensagem_recebida', new.conversation_id, v_lead, null,
        jsonb_build_object('message_id', new.id, 'type', new.type, 'body', left(new.body, 1000)));
    end if;
  end if;
  return null;
exception when others then
  raise warning 'hub_event_message: %', sqlerrm;
  return null;
end;
$$;

create or replace function private.hub_event_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'grupo' or coalesce(current_setting('hub.importing', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform private.emit_hub_event(new.organization_id, 'conversa_nova', new.id, new.lead_id, null, jsonb_build_object('contact_e164', new.contact_e164, 'contact_name', new.contact_name));
  elsif new.status = 'encerrada' and old.status is distinct from 'encerrada' then
    perform private.emit_hub_event(new.organization_id, 'conversa_encerrada', new.id, new.lead_id, null, jsonb_build_object('outcome', new.outcome));
  end if;
  return null;
exception when others then
  raise warning 'hub_event_conversation: %', sqlerrm;
  return null;
end;
$$;

create or replace function private.notify_inbound_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.conversations;
  v_user uuid;
  v_title text;
  v_body text;
  v_key text;
begin
  if new.direction <> 'entrada' or coalesce(current_setting('hub.importing', true), '') = 'on' then
    return null;
  end if;
  select * into c from public.conversations where id = new.conversation_id;
  if c.id is null then
    return null;
  end if;
  if c.kind = 'grupo' then
    v_title := 'Mensagem no grupo ' || coalesce(nullif(c.contact_name, ''), 'do WhatsApp');
    v_body := case when new.sender_name is not null then new.sender_name || ': ' else '' end || coalesce(new.body, '');
  else
    v_title := 'Mensagem de ' || coalesce(nullif(c.contact_name, ''), c.contact_e164);
    v_body := new.body;
  end if;
  v_key := 'mensagem:' || c.id || ':' || to_char(new.created_at at time zone 'UTC', 'YYYYMMDDHH24');
  for v_user in
    select p.id from public.profiles p
     where p.organization_id = c.organization_id and p.is_active
       and (p.id = c.assignee_id or (c.assignee_id is null and private.user_has_perm(p.id, 'inbox.manage')))
  loop
    perform private.notify(c.organization_id, v_user, 'mensagem', v_title, left(v_body, 200), '/atendimento?conversa=' || c.id, v_key);
  end loop;
  return null;
end;
$$;

-- Indicadores medem atendimento: grupos ficam de fora. O histórico fica de fora pela data de criação (a da primeira mensagem).
create or replace function public.inbox_report(p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select c.* from public.conversations c
     where c.kind = 'contato' and c.imported_at is null
       and (c.created_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'open', (select count(*) from base where status = 'aberta'),
    'closed', (select count(*) from base where status = 'encerrada'),
    'waiting', (select count(*) from base where status = 'aberta' and waiting_reply),
    'avg_first_response_seconds', (select round(avg(extract(epoch from first_response_at - created_at))) from base where first_response_at is not null),
    'by_assignee', coalesce((
      select jsonb_agg(row_to_json(x) order by x.total desc) from (
        select b.assignee_id, coalesce(p.full_name, p.email, 'Sem responsável') as name, count(*) as total,
               count(*) filter (where b.status = 'encerrada') as closed,
               round(avg(extract(epoch from b.first_response_at - b.created_at))) as avg_first_response_seconds
          from base b left join public.profiles p on p.id = b.assignee_id
         group by b.assignee_id, p.full_name, p.email
      ) x), '[]'::jsonb),
    'by_outcome', coalesce((
      select jsonb_agg(row_to_json(y) order by y.total desc) from (
        select trim(split_part(outcome, ':', 1)) as outcome, count(*) as total from base where outcome is not null group by 1
      ) y), '[]'::jsonb)
  );
$$;
revoke execute on function public.inbox_report(date, date) from public, anon;
grant execute on function public.inbox_report(date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- Mensagem de grupo em tempo real (chamada pelo webhook, service_role). Idempotente por wamid.
-- -----------------------------------------------------------------------------
create or replace function public.whatsapp_group_message(
  p_number uuid, p_group_jid text, p_group_name text, p_wamid text, p_from_me boolean, p_type text, p_body text,
  p_media_id text, p_media_mime text, p_media_name text, p_at timestamptz, p_sender_jid text, p_sender_name text, p_reply_to text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_conv uuid;
  v_msg uuid;
begin
  select organization_id into v_org from public.whatsapp_numbers where id = p_number;
  if v_org is null then
    raise exception 'Número não encontrado.' using errcode = 'P0002';
  end if;
  insert into public.conversations (organization_id, number_id, kind, group_jid, contact_name)
  values (v_org, p_number, 'grupo', p_group_jid, left(coalesce(p_group_name, ''), 120))
  on conflict (number_id, group_jid) where group_jid is not null
    do update set contact_name = coalesce(nullif(left(p_group_name, 120), ''), public.conversations.contact_name)
  returning id into v_conv;

  insert into public.messages (organization_id, conversation_id, direction, wamid, type, body, media_id, media_mime, media_name, status, created_at, sender_jid, sender_name, reply_to_wamid)
  values (v_org, v_conv, case when p_from_me then 'saida' else 'entrada' end, p_wamid, p_type, left(p_body, 4096), p_media_id, p_media_mime, p_media_name,
          case when p_from_me then 'enviada' else 'recebida' end, coalesce(p_at, now()), left(p_sender_jid, 120), left(p_sender_name, 120), p_reply_to)
  on conflict (wamid) do nothing
  returning id into v_msg;
  if v_msg is null then
    return null;
  end if;

  update public.conversations
     set last_message_at = greatest(coalesce(last_message_at, p_at), p_at),
         unread_count = case when p_from_me then 0 else unread_count + 1 end,
         status = 'aberta'
   where id = v_conv;
  return v_msg;
end;
$$;
revoke execute on function public.whatsapp_group_message(uuid, text, text, text, boolean, text, text, text, text, text, timestamptz, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_group_message(uuid, text, text, text, boolean, text, text, text, text, text, timestamptz, text, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- Importação de uma conversa do histórico (service_role). Pode repetir sem duplicar.
-- Nada de não lidas, espera de resposta, cadência, automação ou pedido de interrupção.
-- -----------------------------------------------------------------------------
create or replace function public.whatsapp_import_chat(
  p_number uuid, p_kind text, p_e164 text, p_variants text[], p_group_jid text, p_name text, p_messages jsonb
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_conv uuid;
  v_lead uuid;
  v_first timestamptz;
  v_last timestamptz;
  v_last_in timestamptz;
  v_created boolean := false;
  v_count int;
begin
  select organization_id into v_org from public.whatsapp_numbers where id = p_number;
  if v_org is null then
    raise exception 'Número não encontrado.' using errcode = 'P0002';
  end if;
  perform set_config('hub.importing', 'on', true);

  select min((m->>'at')::timestamptz), max((m->>'at')::timestamptz), max((m->>'at')::timestamptz) filter (where m->>'direction' = 'entrada')
    into v_first, v_last, v_last_in
    from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb)) m;

  if p_kind = 'grupo' then
    select id into v_conv from public.conversations where number_id = p_number and group_jid = p_group_jid;
    if v_conv is null then
      insert into public.conversations (organization_id, number_id, kind, group_jid, contact_name, created_at, imported_at)
      values (v_org, p_number, 'grupo', p_group_jid, left(coalesce(p_name, ''), 120), coalesce(v_first, now()), now())
      on conflict (number_id, group_jid) where group_jid is not null do nothing
      returning id into v_conv;
      v_created := v_conv is not null;
      if v_conv is null then
        select id into v_conv from public.conversations where number_id = p_number and group_jid = p_group_jid;
      end if;
    end if;
  else
    select id into v_conv from public.conversations where number_id = p_number and contact_e164 = any (p_variants) limit 1;
    if v_conv is null then
      select id into v_lead from public.leads
       where organization_id = v_org and deleted_at is null and (phone_e164 = any (p_variants) or whatsapp_e164 = any (p_variants))
       order by created_at limit 1;
      insert into public.conversations (organization_id, number_id, contact_e164, contact_name, lead_id, assignee_id, created_at, imported_at)
      values (v_org, p_number, p_e164, left(coalesce(p_name, ''), 120), v_lead, (select owner_id from public.leads where id = v_lead), coalesce(v_first, now()), now())
      on conflict (number_id, contact_e164) do nothing
      returning id into v_conv;
      v_created := v_conv is not null;
      if v_conv is null then
        select id into v_conv from public.conversations where number_id = p_number and contact_e164 = any (p_variants) limit 1;
      end if;
    end if;
  end if;

  insert into public.messages (organization_id, conversation_id, direction, wamid, type, body, status, created_at, sender_jid, sender_name, reply_to_wamid, imported)
  select v_org, v_conv, m.direction, m.wamid, m.type, left(m.body, 4096), case when m.direction = 'saida' then 'lida' else 'recebida' end, m.at, left(m.sender_jid, 120), left(m.sender_name, 120), m.reply_to, true
    from jsonb_to_recordset(coalesce(p_messages, '[]'::jsonb))
         as m(wamid text, direction text, type text, body text, at timestamptz, sender_jid text, sender_name text, reply_to text)
   where m.direction in ('entrada', 'saida')
  on conflict (wamid) do nothing;
  get diagnostics v_count = row_count;

  update public.conversations
     set last_message_at = greatest(last_message_at, v_last),
         last_inbound_at = greatest(last_inbound_at, v_last_in),
         contact_name = case when kind = 'grupo' then coalesce(nullif(left(p_name, 120), ''), contact_name)
                             when contact_name = '' then left(coalesce(p_name, ''), 120) else contact_name end
   where id = v_conv;
  -- Só marca como histórico o que nasceu aqui: conversa em andamento continua contando no radar e nos indicadores.
  if v_created then
    update public.conversations set imported_at = greatest(now(), coalesce(last_message_at, now())) where id = v_conv;
  end if;
  perform set_config('hub.importing', 'off', true);
  return v_count;
end;
$$;
revoke execute on function public.whatsapp_import_chat(uuid, text, text, text[], text, text, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_import_chat(uuid, text, text, text[], text, text, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- Andamento da importação
-- -----------------------------------------------------------------------------
create table public.whatsapp_imports (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  number_id        uuid not null references public.whatsapp_numbers (id) on delete cascade,
  status           text not null default 'importando' check (status in ('importando', 'aguardando', 'concluida', 'erro', 'cancelada')),
  include_contacts boolean not null default true,
  include_groups   boolean not null default true,
  pass             int not null default 1,
  next_offset      int not null default 0,
  not_before       timestamptz not null default now(),
  lease_until      timestamptz,
  contacts_done    int not null default 0,
  groups_done      int not null default 0,
  skipped          int not null default 0,
  messages_done    int not null default 0,
  last_error       text check (char_length(last_error) <= 500),
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create unique index whatsapp_imports_active_uq on public.whatsapp_imports (number_id) where status in ('importando', 'aguardando');
create index whatsapp_imports_number_idx on public.whatsapp_imports (number_id, created_at desc);
alter table public.whatsapp_imports enable row level security;
grant select on public.whatsapp_imports to authenticated;
grant all on public.whatsapp_imports to service_role;
revoke insert, update, delete on public.whatsapp_imports from authenticated, anon;
create policy whatsapp_imports_select on public.whatsapp_imports for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('inbox.read')));

-- O relógio também acorda a compilação de conversas: ela continua com a tela fechada.
create or replace function private.inbox_jobs_pending()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.hub_events where claimed_at is null)
      or exists (select 1 from public.automation_runs where status = 'pendente' and run_after <= now())
      or exists (select 1 from public.webhook_deliveries where status = 'pendente' and next_try_at <= now())
      or exists (select 1 from public.conversion_events where status = 'pendente')
      or exists (select 1 from public.campaigns where status = 'enviando' and (scheduled_at is null or scheduled_at <= now()))
      or exists (select 1 from public.inbox_settings where billing_enabled)
      or exists (select 1 from public.content_schedules where status in ('agendado', 'publicando') and scheduled_at <= now())
      or exists (select 1 from public.whatsapp_imports where status in ('importando', 'aguardando') and not_before <= now());
$$;
revoke execute on function private.inbox_jobs_pending() from public, anon, authenticated;
