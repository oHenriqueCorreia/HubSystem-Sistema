-- HubSystem · migrations pendentes (20261102170000 em diante) em um único script.
-- Como usar: Supabase → SQL Editor → New query → cole TODO este arquivo → Run.
-- Tudo roda numa transação: se algo falhar, nada é aplicado. Rode uma única vez.
-- Gerado a partir de supabase/migrations/. Não edite à mão.

begin;

-- ===== supabase/migrations/20261102170000_invitations_check_new_only.sql
-- =============================================================================
-- Regra de "ambiente próprio": não barra a exclusão de quem convidou
-- =============================================================================
-- Excluir uma conta limpa invitations.invited_by (on delete set null). O gatilho
-- via o convite de ambiente sem autor e recusava, e a conta não podia ser excluída.
-- Agora ele só avalia quem está sendo definido como autor; ao criar o convite,
-- continua exigindo um autor autorizado.
-- =============================================================================

create or replace function private.invitations_check_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.invited_by is null then
    return new;
  end if;
  if new.mode = 'ambiente'
     and not exists (select 1 from private.workspace_creators c where c.user_id = new.invited_by) then
    raise exception 'Sem autorização para criar empresas novas por convite.' using errcode = '42501';
  end if;
  return new;
end;
$$;

insert into supabase_migrations.schema_migrations (version, name) values ('20261102170000', 'invitations_check_new_only') on conflict do nothing;

commit;
