-- =============================================================================
-- Fase 8 · WhatsApp (Cloud API oficial) e central de atendimento
-- Fase 9 (base) · consentimento, interrupção e pausa de cadência na resposta
-- =============================================================================
-- * Números conectados guardam o token cifrado (somente servidor).
-- * Idempotência: mensagens únicas por wamid; envios do sistema também têm
--   client_ref único (um clique repetido não envia duas vezes).
-- * Notas internas ficam na mesma linha do tempo, com direction = 'nota'.
-- =============================================================================

insert into public.permissions (key, module, label, position) values
  ('inbox.read', 'Atendimento', 'Ver conversas do WhatsApp', 55),
  ('inbox.reply', 'Atendimento', 'Responder conversas', 56),
  ('inbox.manage', 'Atendimento', 'Conectar números, transferir e configurar o atendimento', 57)
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key, scope)
select r.id, p.key, x.scope::public.permission_scope
from public.roles r
join (values
  ('admin', 'inbox.read', 'all'), ('admin', 'inbox.reply', 'all'), ('admin', 'inbox.manage', 'all'),
  ('gestor', 'inbox.read', 'all'), ('gestor', 'inbox.reply', 'all'), ('gestor', 'inbox.manage', 'all'),
  ('atendente', 'inbox.read', 'own'), ('atendente', 'inbox.reply', 'own'),
  ('vendedor', 'inbox.read', 'own'), ('vendedor', 'inbox.reply', 'own'),
  ('leitura', 'inbox.read', 'all')
) as x(role_key, key, scope) on x.role_key = r.key
join public.permissions p on p.key = x.key
on conflict do nothing;

-- Consentimento e pedido de interrupção no lead.
alter table public.leads
  add column whatsapp_consent_at timestamptz,
  add column contact_opt_out_at timestamptz;

-- -----------------------------------------------------------------------------
-- Números conectados (somente servidor) + visão segura
-- -----------------------------------------------------------------------------
create table public.whatsapp_numbers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  phone_number_id  text not null unique check (phone_number_id ~ '^\d{5,30}$'),
  waba_id          text not null check (waba_id ~ '^\d{5,30}$'),
  display_phone    text not null default '',
  verified_name    text not null default '',
  token_enc        text not null,
  status           text not null default 'ativo' check (status in ('ativo', 'erro', 'desconectado')),
  quality          text,
  last_error       text,
  connected_by     uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.whatsapp_numbers enable row level security;
revoke all on public.whatsapp_numbers from authenticated, anon;

create or replace function public.my_whatsapp_numbers()
returns table (id uuid, display_phone text, verified_name text, status text, quality text, last_error text, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.display_phone, n.verified_name, n.status, n.quality, n.last_error, n.updated_at
  from public.whatsapp_numbers n
  where n.organization_id = private.org_id() and private.has_perm('inbox.read');
$$;
revoke execute on function public.my_whatsapp_numbers() from public, anon;
grant execute on function public.my_whatsapp_numbers() to authenticated;

-- -----------------------------------------------------------------------------
-- Conversas e mensagens
-- -----------------------------------------------------------------------------
create table public.conversations (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  number_id         uuid not null references public.whatsapp_numbers (id) on delete cascade,
  contact_e164      text not null check (contact_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  contact_name      text not null default '' check (char_length(contact_name) <= 120),
  lead_id           uuid references public.leads (id) on delete set null,
  assignee_id       uuid references public.profiles (id) on delete set null,
  status            text not null default 'aberta' check (status in ('aberta', 'encerrada')),
  waiting_reply     boolean not null default false,
  last_message_at   timestamptz,
  last_inbound_at   timestamptz,
  first_response_at timestamptz,
  unread_count      int not null default 0,
  outcome           text check (char_length(outcome) <= 500),
  created_at        timestamptz not null default now(),
  unique (number_id, contact_e164)
);
create index conversations_org_idx on public.conversations (organization_id, status, last_message_at desc);
create index conversations_lead_idx on public.conversations (lead_id);
create index conversations_assignee_idx on public.conversations (assignee_id);

create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  direction        text not null check (direction in ('entrada', 'saida', 'nota')),
  wamid            text unique,
  client_ref       uuid unique,
  type             text not null default 'text' check (type in ('text', 'image', 'document', 'audio', 'video', 'sticker', 'template', 'location', 'contacts', 'reaction', 'unsupported', 'note')),
  body             text check (char_length(body) <= 4096),
  media_id         text,
  media_mime       text,
  media_name       text,
  status           text not null default 'enviada' check (status in ('recebida', 'enviando', 'enviada', 'entregue', 'lida', 'erro')),
  error            text,
  author_id        uuid references public.profiles (id) on delete set null,
  important        boolean not null default false,
  created_at       timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

create table public.conversation_tags (
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  tag_id           uuid not null references public.tags (id) on delete cascade,
  primary key (conversation_id, tag_id)
);

create table public.whatsapp_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  waba_id          text not null,
  name             text not null,
  language         text not null,
  category         text,
  status           text not null,
  components       jsonb not null default '[]'::jsonb,
  synced_at        timestamptz not null default now(),
  unique (organization_id, waba_id, name, language)
);

-- Acesso: own = conversas atribuídas a mim (ou ainda sem responsável).
create or replace function private.can_read_conversation(p_conv uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conv and c.organization_id = private.org_id()
      and (private.can('inbox.read', c.assignee_id) or (c.assignee_id is null and private.has_perm('inbox.read')))
  );
$$;
grant execute on function private.can_read_conversation(uuid) to authenticated;

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_tags enable row level security;
alter table public.whatsapp_templates enable row level security;

create policy conversations_select on public.conversations for select to authenticated
  using (organization_id = (select private.org_id())
         and (private.can('inbox.read', assignee_id) or (assignee_id is null and (select private.has_perm('inbox.read')))));
create policy conversations_update on public.conversations for update to authenticated
  using (organization_id = (select private.org_id())
         and (private.can('inbox.reply', assignee_id) or (assignee_id is null and (select private.has_perm('inbox.reply')))
              or (select private.has_perm('inbox.manage'))))
  with check (organization_id = (select private.org_id()));
revoke insert, delete on public.conversations from authenticated;

create policy messages_select on public.messages for select to authenticated
  using (private.can_read_conversation(conversation_id));
-- Pelo navegador só entram notas internas; mensagens ao cliente passam pelo servidor.
create policy messages_insert_note on public.messages for insert to authenticated
  with check (private.can_read_conversation(conversation_id) and direction = 'nota' and type = 'note'
              and author_id = (select auth.uid()) and organization_id = (select private.org_id()));
create policy messages_update on public.messages for update to authenticated
  using (private.can_read_conversation(conversation_id));
revoke update on public.messages from authenticated;
grant update (important) on public.messages to authenticated;

create policy conversation_tags_select on public.conversation_tags for select to authenticated
  using (private.can_read_conversation(conversation_id));
create policy conversation_tags_write on public.conversation_tags for all to authenticated
  using (private.can_read_conversation(conversation_id))
  with check (private.can_read_conversation(conversation_id)
              and exists (select 1 from public.tags t where t.id = tag_id and t.organization_id = (select private.org_id())));

create policy whatsapp_templates_select on public.whatsapp_templates for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('inbox.read')));
revoke insert, update, delete on public.whatsapp_templates from authenticated;

create trigger audit_conversations after update on public.conversations
  for each row execute function private.audit_row('', 'assignee_id,status,lead_id');

-- -----------------------------------------------------------------------------
-- Mensagem recebida (chamada pelo webhook, service_role). Idempotente por wamid.
-- Associa ao lead pelo telefone (com e sem 9º dígito), registra na linha do
-- tempo, pausa cadências ativas e trata pedido de interrupção.
-- -----------------------------------------------------------------------------
create or replace function public.whatsapp_receive(
  p_number uuid, p_from text, p_variants text[], p_name text, p_wamid text, p_type text,
  p_body text, p_media_id text, p_media_mime text, p_media_name text, p_at timestamptz, p_opt_out boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_conv public.conversations;
  v_lead uuid;
  v_msg uuid;
begin
  select organization_id into v_org from public.whatsapp_numbers where id = p_number;
  if v_org is null then
    raise exception 'Número não encontrado.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.messages where wamid = p_wamid) then
    return null; -- já processada (reentrega do webhook)
  end if;

  select * into v_conv from public.conversations where number_id = p_number and contact_e164 = any (p_variants) limit 1;
  if v_conv.id is null then
    select id into v_lead from public.leads
     where organization_id = v_org and deleted_at is null
       and (phone_e164 = any (p_variants) or whatsapp_e164 = any (p_variants))
     order by created_at limit 1;
    insert into public.conversations (organization_id, number_id, contact_e164, contact_name, lead_id, assignee_id)
    values (v_org, p_number, p_from, left(coalesce(p_name, ''), 120), v_lead,
            (select owner_id from public.leads where id = v_lead))
    on conflict (number_id, contact_e164) do update set contact_name = excluded.contact_name
    returning * into v_conv;
  end if;

  insert into public.messages (organization_id, conversation_id, direction, wamid, type, body, media_id, media_mime, media_name, status, created_at)
  values (v_org, v_conv.id, 'entrada', p_wamid, p_type, left(p_body, 4096), p_media_id, p_media_mime, p_media_name, 'recebida', coalesce(p_at, now()))
  on conflict (wamid) do nothing
  returning id into v_msg;
  if v_msg is null then
    return null;
  end if;

  update public.conversations
     set last_message_at = greatest(coalesce(last_message_at, p_at), p_at),
         last_inbound_at = greatest(coalesce(last_inbound_at, p_at), p_at),
         waiting_reply = true,
         unread_count = unread_count + 1,
         status = 'aberta',
         contact_name = case when contact_name = '' then left(coalesce(p_name, ''), 120) else contact_name end
   where id = v_conv.id;

  if v_conv.lead_id is not null then
    perform set_config('hub.trusted_op', 'on', true);
    update public.leads set last_contact_at = p_at,
           contact_opt_out_at = case when p_opt_out then coalesce(contact_opt_out_at, now()) else contact_opt_out_at end
     where id = v_conv.lead_id;
    -- Regra automática: quando o lead responde, a cadência ativa é pausada.
    update public.cadence_enrollments set status = 'pausada' where lead_id = v_conv.lead_id and status = 'ativa';
    perform set_config('hub.trusted_op', 'off', true);
    insert into public.activities (organization_id, lead_id, type, content, metadata, occurred_at, created_by)
    values (v_org, v_conv.lead_id, 'whatsapp', 'Mensagem recebida: ' || left(coalesce(p_body, '[' || p_type || ']'), 300),
            jsonb_build_object('conversation_id', v_conv.id, 'origem', 'automatica', 'opt_out', p_opt_out), p_at, null);
  end if;
  return v_msg;
end;
$$;
revoke execute on function public.whatsapp_receive(uuid, text, text[], text, text, text, text, text, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_receive(uuid, text, text[], text, text, text, text, text, text, text, timestamptz, boolean) to service_role;

-- Status de envio (enviada → entregue → lida, ou erro). Nunca "volta".
create or replace function public.whatsapp_status(p_wamid text, p_status text, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.messages
     set status = p_status, error = coalesce(left(p_error, 500), error)
   where wamid = p_wamid
     and (p_status = 'erro'
          or array_position(array['enviando', 'enviada', 'entregue', 'lida'], p_status)
             > coalesce(array_position(array['enviando', 'enviada', 'entregue', 'lida'], status), 0));
$$;
revoke execute on function public.whatsapp_status(text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_status(text, text, text) to service_role;
