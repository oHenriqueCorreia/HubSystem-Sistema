-- =============================================================================
-- Conversas por QR Code só aparecem depois de compilar; desconectar limpa tudo;
-- etiquetas da conversa e do lead são uma coisa só
-- =============================================================================
--   * compiled_at: quando a pessoa pediu para compilar. Antes disso, mensagens continuam
--     sendo gravadas (cadência e pedido de interrupção não podem parar), mas não aparecem
--     nem notificam.
--   * purge_pending: limpeza em andamento depois de desconectar. Continua em segundo plano.
--   * Etiquetas sincronizadas por gatilho, venha a mudança do Atendimento, dos leads ou do funil.
-- =============================================================================

alter table public.whatsapp_numbers
  add column compiled_at timestamptz,
  add column purge_pending boolean not null default false;

drop function public.my_whatsapp_numbers();
create function public.my_whatsapp_numbers()
returns table (id uuid, provider text, display_phone text, verified_name text, status text, quality text, last_error text, updated_at timestamptz, compiled_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.provider, n.display_phone, n.verified_name, n.status, n.quality, n.last_error, n.updated_at, n.compiled_at
  from public.whatsapp_numbers n
  where n.organization_id = private.org_id() and private.has_perm('inbox.read');
$$;
revoke execute on function public.my_whatsapp_numbers() from public, anon;
grant execute on function public.my_whatsapp_numbers() to authenticated;

-- O que ainda não aparece não notifica.
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
  if exists (select 1 from public.whatsapp_numbers n where n.id = c.number_id and n.provider = 'waha' and n.compiled_at is null) then
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

create or replace function private.radar_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_new int;
  v_title text;
  v_href text;
begin
  for r in
    select c.id, c.organization_id, c.assignee_id, c.lead_id, c.contact_name, c.contact_e164, c.last_message_at, s.radar_notify
      from public.conversations c
      left join public.inbox_settings s on s.organization_id = c.organization_id
     where c.status = 'aberta' and c.waiting_reply and c.last_message_at is not null
       and exists (select 1 from public.whatsapp_numbers n where n.id = c.number_id and (n.provider <> 'waha' or n.compiled_at is not null))
       and c.last_message_at < now() - make_interval(mins => coalesce(s.radar_client_minutes, 120))
       and c.last_message_at > now() - interval '7 days'
     limit 500
  loop
    insert into private.radar_alerts (conversation_id, last_message_at) values (r.id, r.last_message_at)
    on conflict do nothing;
    get diagnostics v_new = row_count;
    if v_new > 0 then
      v_title := 'Cliente esperando resposta: ' || coalesce(nullif(r.contact_name, ''), r.contact_e164);
      v_href := '/atendimento?conversa=' || r.id;
      if coalesce(r.radar_notify, true) then
        if r.assignee_id is not null then
          perform private.notify(r.organization_id, r.assignee_id, 'radar_conversa', v_title, null, v_href, 'radar:' || r.id || ':' || extract(epoch from r.last_message_at)::bigint);
        else
          perform public.notify_users(r.organization_id, 'inbox.manage', 'radar_conversa', v_title, null, v_href, 'radar:' || r.id || ':' || extract(epoch from r.last_message_at)::bigint);
        end if;
      end if;
      perform private.emit_hub_event(r.organization_id, 'conversa_esfriou', r.id, r.lead_id, null, jsonb_build_object('last_message_at', r.last_message_at));
    end if;
  end loop;
  delete from private.radar_alerts where created_at < now() - interval '30 days';
  delete from public.hub_events where claimed_at < now() - interval '30 days';
end;
$$;
revoke execute on function private.radar_tick() from public, anon, authenticated;

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
      or exists (select 1 from public.whatsapp_imports where status in ('importando', 'aguardando') and not_before <= now())
      or exists (select 1 from public.whatsapp_numbers where provider = 'waha' and status = 'aguardando_qr')
      or exists (select 1 from public.whatsapp_numbers where purge_pending);
$$;
revoke execute on function private.inbox_jobs_pending() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Etiquetas: conversa e lead sempre iguais. O conflito encerra o vaivém entre os dois gatilhos.
-- -----------------------------------------------------------------------------
create function private.sync_tags_from_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.lead_tags (lead_id, tag_id)
    select c.lead_id, new.tag_id from public.conversations c where c.id = new.conversation_id and c.lead_id is not null
    on conflict do nothing;
  else
    -- Conversa apagada (desconectar o número) não tira a etiqueta do lead: a conversa já não existe aqui.
    delete from public.lead_tags l
     using public.conversations c
     where c.id = old.conversation_id and l.lead_id = c.lead_id and l.tag_id = old.tag_id;
  end if;
  return null;
end;
$$;
create trigger sync_tags_from_conversation after insert or delete on public.conversation_tags
  for each row execute function private.sync_tags_from_conversation();

create function private.sync_tags_from_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.conversation_tags (conversation_id, tag_id)
    select c.id, new.tag_id from public.conversations c where c.lead_id = new.lead_id
    on conflict do nothing;
  else
    delete from public.conversation_tags t
     using public.conversations c
     where c.lead_id = old.lead_id and t.conversation_id = c.id and t.tag_id = old.tag_id;
  end if;
  return null;
end;
$$;
create trigger sync_tags_from_lead after insert or delete on public.lead_tags
  for each row execute function private.sync_tags_from_lead();

-- Conversa que passa a ter lead junta as etiquetas dos dois lados.
create function private.sync_tags_on_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.conversation_tags (conversation_id, tag_id)
  select new.id, l.tag_id from public.lead_tags l where l.lead_id = new.lead_id
  on conflict do nothing;
  insert into public.lead_tags (lead_id, tag_id)
  select new.lead_id, t.tag_id from public.conversation_tags t where t.conversation_id = new.id
  on conflict do nothing;
  return null;
end;
$$;
create trigger sync_tags_on_link after insert or update of lead_id on public.conversations
  for each row when (new.lead_id is not null) execute function private.sync_tags_on_link();

-- O que já existe começa alinhado.
insert into public.conversation_tags (conversation_id, tag_id)
select c.id, l.tag_id from public.conversations c join public.lead_tags l on l.lead_id = c.lead_id
on conflict do nothing;
insert into public.lead_tags (lead_id, tag_id)
select c.lead_id, t.tag_id from public.conversations c join public.conversation_tags t on t.conversation_id = c.id where c.lead_id is not null
on conflict do nothing;

-- Quem atende pode criar a própria etiqueta na conversa.
drop policy tags_insert on public.tags;
create policy tags_insert on public.tags for insert to authenticated
  with check (organization_id = (select private.org_id())
              and ((select private.has_perm('tags.manage')) or (select private.has_perm('crm.leads.update'))
                   or (select private.has_perm('tasks.create')) or (select private.has_perm('inbox.reply'))));
