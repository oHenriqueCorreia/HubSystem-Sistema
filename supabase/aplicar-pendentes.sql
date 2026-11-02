-- HubSystem · migrations pendentes (20261102130000 em diante) em um único script.
-- Como usar: Supabase → SQL Editor → New query → cole TODO este arquivo → Run.
-- Tudo roda numa transação: se algo falhar, nada é aplicado. Rode uma única vez.
-- Gerado a partir de supabase/migrations/. Não edite à mão.

begin;

-- ===== supabase/migrations/20261102130000_invite_only_oauth.sql
-- =============================================================================
-- Contas novas somente por convite (e-mail, Google ou outro provedor)
-- =============================================================================
-- Antes: qualquer cadastro público criava uma empresa nova, e os dados do
-- cadastro (raw_user_meta_data, enviados por quem se cadastra) podiam apontar
-- para a organização de outra pessoa.
-- Agora a conta só nasce se existir um convite PENDENTE e válido para aquele
-- e-mail; organização, modo e papel vêm do convite, nunca do cadastro.
-- Quem já tem conta e entra com Google usando o mesmo e-mail continua entrando:
-- o Supabase liga o Google à conta existente e este gatilho nem roda.
-- =============================================================================

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_inv public.invitations;
  v_org uuid;
  v_role uuid;
begin
  if (v_meta ->> 'invitation_id') ~ '^[0-9a-fA-F-]{36}$' then
    select * into v_inv from public.invitations
     where id = (v_meta ->> 'invitation_id')::uuid
       and lower(email) = lower(coalesce(new.email, ''))
       and status = 'pendente'
       and expires_at > now();
  end if;
  if v_inv.id is null then
    raise exception 'Acesso somente por convite.' using errcode = '42501';
  end if;

  if v_inv.mode = 'equipe' then
    v_org := v_inv.organization_id;
    v_role := v_inv.role_id;
  else
    -- "Ambiente próprio": empresa nova e vazia, com a pessoa como administradora.
    insert into public.organizations (name)
    values (left(coalesce(nullif(trim(v_inv.workspace_name), ''), 'Empresa de ' || split_part(coalesce(new.email, ''), '@', 1)), 120))
    returning id into v_org;
    select id into v_role from public.roles where organization_id = v_org and key = 'admin';
  end if;
  if v_role is null or not exists (select 1 from public.roles where id = v_role and organization_id = v_org) then
    select id into v_role from public.roles where organization_id = v_org and key = 'colaborador';
  end if;

  -- Perfil fica inativo até a pessoa aceitar o convite (/convite/<token>).
  insert into public.profiles (id, organization_id, full_name, email, is_active)
  values (new.id, v_org, coalesce(nullif(trim(v_inv.full_name), ''), ''), coalesce(new.email, ''), false);
  insert into public.user_roles (user_id, role_id, created_by) values (new.id, v_role, null);
  return new;
end;
$$;

insert into supabase_migrations.schema_migrations (version, name) values ('20261102130000', 'invite_only_oauth') on conflict do nothing;

commit;
