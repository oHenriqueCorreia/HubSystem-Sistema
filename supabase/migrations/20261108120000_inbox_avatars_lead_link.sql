-- =============================================================================
-- Atendimento · fotos de perfil de contatos e grupos
-- =============================================================================
--   * avatar_url: foto de perfil vinda do WhatsApp (link assinado do próprio
--     WhatsApp, que expira; por isso é buscado de novo de tempos em tempos).
--   * avatar_checked_at: última busca (com ou sem foto), para não consultar o
--     servidor do WhatsApp a cada abertura da tela.
--   * Escrita só pelo servidor; leitura segue a regra de acesso da conversa.
-- =============================================================================

alter table public.conversations
  add column avatar_url        text check (avatar_url ~ '^https://' and char_length(avatar_url) <= 2000),
  add column avatar_checked_at timestamptz;

-- Quem usa o sistema não troca a foto (evita apontar para links de fora); só o servidor.
create or replace function private.conversation_avatar_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    new.avatar_url := old.avatar_url;
    new.avatar_checked_at := old.avatar_checked_at;
  end if;
  return new;
end;
$$;
create trigger conversation_avatar_guard before update of avatar_url, avatar_checked_at on public.conversations
  for each row execute function private.conversation_avatar_guard();

-- =============================================================================
-- Lead ↔ conversa: quando um lead é criado (cadastro, importação, Prospectador)
-- ou ganha telefone, as conversas já existentes com o mesmo número passam a ser
-- dele. Antes, a ligação só acontecia na primeira mensagem recebida.
-- =============================================================================

-- Número brasileiro com e sem o 9º dígito (o WhatsApp registra dos dois jeitos).
create or replace function private.br_phone_variants(p_e164 text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_e164 is null then '{}'::text[]
    when p_e164 ~ '^\+55[1-9][0-9]9[0-9]{8}$' then array[p_e164, substr(p_e164, 1, 5) || substr(p_e164, 7)]
    when p_e164 ~ '^\+55[1-9][0-9][6-9][0-9]{7}$' then array[p_e164, substr(p_e164, 1, 5) || '9' || substr(p_e164, 6)]
    else array[p_e164]
  end;
$$;

create or replace function private.link_lead_conversations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_numbers text[] := private.br_phone_variants(new.phone_e164) || private.br_phone_variants(new.whatsapp_e164);
begin
  if new.deleted_at is not null or cardinality(v_numbers) = 0 then
    return new;
  end if;
  update public.conversations c
     set lead_id = new.id,
         assignee_id = coalesce(c.assignee_id, new.owner_id)
   where c.organization_id = new.organization_id
     and c.lead_id is null
     and c.kind = 'contato'
     and c.contact_e164 = any (v_numbers);
  return new;
end;
$$;
revoke execute on function private.link_lead_conversations() from public, anon, authenticated;

create trigger leads_link_conversations after insert or update of phone_e164, whatsapp_e164, deleted_at on public.leads
  for each row execute function private.link_lead_conversations();

-- Conversas antigas que já tinham lead com o mesmo número: liga agora, uma vez.
update public.conversations c
   set lead_id = l.id,
       assignee_id = coalesce(c.assignee_id, l.owner_id)
  from public.leads l
 where c.lead_id is null
   and c.kind = 'contato'
   and l.organization_id = c.organization_id
   and l.deleted_at is null
   and c.contact_e164 = any (private.br_phone_variants(l.phone_e164) || private.br_phone_variants(l.whatsapp_e164));
