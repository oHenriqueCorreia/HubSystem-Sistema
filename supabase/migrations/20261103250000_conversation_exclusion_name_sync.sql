-- =============================================================================
-- Excluir conversas e grupos do Atendimento, e nome da pessoa igual em todo lugar
-- =============================================================================
--   * A linha da conversa fica, marcada com excluded_at: é ela que impede o grupo de
--     voltar sozinho a cada mensagem nova ou a cada compilação.
--   * Conversa individual volta quando chega ou sai mensagem nova, como no WhatsApp.
--   * Nome: mudar no lead (leads, funil, importação) muda também nas conversas dele.
-- =============================================================================

alter table public.conversations add column excluded_at timestamptz;
create index conversations_excluded_idx on public.conversations (number_id) where excluded_at is not null;

create function private.reopen_excluded_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction in ('entrada', 'saida') and not new.imported then
    update public.conversations set excluded_at = null
     where id = new.conversation_id and excluded_at is not null and kind = 'contato';
  end if;
  return null;
end;
$$;
create trigger reopen_excluded_conversation after insert on public.messages
  for each row execute function private.reopen_excluded_conversation();

create function private.sync_lead_name_to_conversations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations set contact_name = left(new.name, 120)
   where lead_id = new.id and contact_name is distinct from left(new.name, 120);
  return null;
end;
$$;
create trigger sync_lead_name_to_conversations after update of name on public.leads
  for each row when (old.name is distinct from new.name) execute function private.sync_lead_name_to_conversations();
