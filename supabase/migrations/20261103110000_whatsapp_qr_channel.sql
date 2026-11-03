-- =============================================================================
-- Atendimento · WhatsApp por QR Code (WAHA) ao lado da API oficial
-- =============================================================================
--   * whatsapp_numbers.provider: 'cloud' (API oficial, como já era) ou 'waha'
--     (QR Code, conexão não oficial, em servidor próprio).
--   * Número por QR guarda endereço, sessão, chave da API (token_enc) e o
--     segredo do webhook, cifrados pelo servidor.
--   * whatsapp_record_outgoing: mensagem enviada pelo celular aparece na conversa.
--   * Mídias do QR e arquivos enviados ficam no bucket privado whatsapp-media:
--     só o servidor grava e lê (a rota de mídia confere o acesso à conversa).
--   * Tempo real: conversas e mensagens entram na publicação (a RLS filtra).
--   * Respostas rápidas para o atendimento.
-- =============================================================================

alter table public.whatsapp_numbers
  add column provider text not null default 'cloud' check (provider in ('cloud', 'waha')),
  add column waha_url text check (waha_url ~ '^https?://' and char_length(waha_url) <= 300),
  add column waha_session text check (waha_session ~ '^[a-z0-9_-]{1,60}$'),
  add column webhook_secret_enc text,
  alter column phone_number_id drop not null,
  alter column waba_id drop not null,
  add constraint whatsapp_numbers_provider_ck check (
    (provider = 'cloud' and phone_number_id is not null and waba_id is not null)
    or (provider = 'waha' and waha_url is not null and waha_session is not null and webhook_secret_enc is not null)
  );

alter table public.whatsapp_numbers drop constraint whatsapp_numbers_status_check;
alter table public.whatsapp_numbers add constraint whatsapp_numbers_status_check check (status in ('ativo', 'erro', 'desconectado', 'aguardando_qr'));

-- A visão segura passa a dizer o tipo do canal (nunca a chave nem o segredo).
drop function public.my_whatsapp_numbers();
create function public.my_whatsapp_numbers()
returns table (id uuid, provider text, display_phone text, verified_name text, status text, quality text, last_error text, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.provider, n.display_phone, n.verified_name, n.status, n.quality, n.last_error, n.updated_at
  from public.whatsapp_numbers n
  where n.organization_id = private.org_id() and private.has_perm('inbox.read');
$$;
revoke execute on function public.my_whatsapp_numbers() from public, anon;
grant execute on function public.my_whatsapp_numbers() to authenticated;

-- Mensagem enviada pelo próprio celular (eco do QR). Idempotente por wamid.
create or replace function public.whatsapp_record_outgoing(
  p_number uuid, p_to text, p_variants text[], p_name text, p_wamid text, p_type text,
  p_body text, p_media_id text, p_media_mime text, p_media_name text, p_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_conv uuid;
  v_lead uuid;
  v_msg uuid;
begin
  select organization_id into v_org from public.whatsapp_numbers where id = p_number;
  if v_org is null then
    raise exception 'Número não encontrado.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.messages where wamid = p_wamid) then
    return null; -- o próprio sistema enviou ou o webhook reentregou
  end if;
  select id into v_conv from public.conversations where number_id = p_number and contact_e164 = any (p_variants) limit 1;
  if v_conv is null then
    select id into v_lead from public.leads
     where organization_id = v_org and deleted_at is null and (phone_e164 = any (p_variants) or whatsapp_e164 = any (p_variants))
     order by created_at limit 1;
    insert into public.conversations (organization_id, number_id, contact_e164, contact_name, lead_id, assignee_id)
    values (v_org, p_number, p_to, left(coalesce(p_name, ''), 120), v_lead, (select owner_id from public.leads where id = v_lead))
    on conflict (number_id, contact_e164) do update set contact_name = public.conversations.contact_name
    returning id into v_conv;
  end if;
  insert into public.messages (organization_id, conversation_id, direction, wamid, type, body, media_id, media_mime, media_name, status, created_at)
  values (v_org, v_conv, 'saida', p_wamid, p_type, left(p_body, 4096), p_media_id, p_media_mime, p_media_name, 'enviada', coalesce(p_at, now()))
  on conflict (wamid) do nothing
  returning id into v_msg;
  if v_msg is null then
    return null;
  end if;
  update public.conversations
     set last_message_at = greatest(coalesce(last_message_at, p_at), p_at), waiting_reply = false, unread_count = 0,
         first_response_at = coalesce(first_response_at, case when last_inbound_at is not null then p_at end)
   where id = v_conv;
  return v_msg;
end;
$$;
revoke execute on function public.whatsapp_record_outgoing(uuid, text, text[], text, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.whatsapp_record_outgoing(uuid, text, text[], text, text, text, text, text, text, text, timestamptz) to service_role;

-- Bucket privado: sem política para usuários, só o servidor acessa.
insert into storage.buckets (id, name, public, file_size_limit)
values ('whatsapp-media', 'whatsapp-media', false, 52428800)
on conflict (id) do nothing;

-- Conversa atualiza sozinha (a RLS define quem recebe o quê).
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.messages;

-- Respostas rápidas: texto pronto com atalho "/" e variáveis {nome} e {empresa}.
create table public.quick_replies (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  shortcut         text not null check (shortcut ~ '^[a-z0-9_-]{1,30}$'),
  body             text not null check (char_length(btrim(body)) between 1 and 4096),
  created_by       uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (organization_id, shortcut)
);
alter table public.quick_replies enable row level security;
grant select, insert, update, delete on public.quick_replies to authenticated;
grant all on public.quick_replies to service_role;
create policy quick_replies_select on public.quick_replies for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('inbox.read')));
create policy quick_replies_write on public.quick_replies for all to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('inbox.manage')))
  with check (organization_id = (select private.org_id()) and (select private.has_perm('inbox.manage')));
