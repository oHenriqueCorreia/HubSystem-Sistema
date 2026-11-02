begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- Dois administradores criados por convite: um autorizado a criar empresas, outro não.
insert into public.organizations (id, name) values ('c0000000-0000-0000-0000-00000000000a', 'Org teste');

create or replace function pg_temp.mk_admin(p_id uuid, p_email text)
returns void language plpgsql as $$
declare
  v_inv uuid := gen_random_uuid();
  v_role uuid;
begin
  select id into v_role from public.roles where organization_id = 'c0000000-0000-0000-0000-00000000000a' and key = 'admin';
  insert into public.invitations (id, organization_id, email, mode, role_id, token_hash)
  values (v_inv, 'c0000000-0000-0000-0000-00000000000a', p_email, 'equipe', v_role, 'hash-' || v_inv);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
          jsonb_build_object('invitation_id', v_inv), now(), now());
  update public.invitations set user_id = p_id where id = v_inv;
  perform public.finalize_invitation(v_inv, 'Admin');
end;
$$;

select pg_temp.mk_admin('c0000000-0000-0000-0000-000000000001', 'dono@t.com');
select pg_temp.mk_admin('c0000000-0000-0000-0000-000000000002', 'outro@t.com');
insert into private.workspace_creators (user_id) values ('c0000000-0000-0000-0000-000000000001');

select lives_ok($$
  insert into public.invitations (organization_id, email, mode, workspace_name, token_hash, invited_by)
  values ('c0000000-0000-0000-0000-00000000000a', 'novo1@t.com', 'ambiente', 'Empresa 1', 'h1', 'c0000000-0000-0000-0000-000000000001')
$$, 'conta autorizada convida para ambiente próprio');

select throws_ok($$
  insert into public.invitations (organization_id, email, mode, workspace_name, token_hash, invited_by)
  values ('c0000000-0000-0000-0000-00000000000a', 'novo2@t.com', 'ambiente', 'Empresa 2', 'h2', 'c0000000-0000-0000-0000-000000000002')
$$, '42501', null, 'outro administrador não convida para ambiente próprio');

select lives_ok($$
  insert into public.invitations (organization_id, email, mode, role_id, token_hash, invited_by)
  select 'c0000000-0000-0000-0000-00000000000a', 'novo3@t.com', 'equipe', r.id, 'h3', 'c0000000-0000-0000-0000-000000000002'
  from public.roles r where r.organization_id = 'c0000000-0000-0000-0000-00000000000a' and r.key = 'colaborador'
$$, 'outro administrador continua convidando para a equipe');

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-000000000001'::uuid, 'role', 'authenticated')::text, true);
select ok(public.can_create_workspaces(), 'can_create_workspaces: verdadeiro para a conta autorizada');

select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-000000000002'::uuid, 'role', 'authenticated')::text, true);
select ok(not public.can_create_workspaces(), 'can_create_workspaces: falso para outro administrador');

select set_config('role', 'none', true), set_config('request.jwt.claims', '', true);

select throws_ok($$
  insert into public.invitations (organization_id, email, mode, workspace_name, token_hash)
  values ('c0000000-0000-0000-0000-00000000000a', 'novo4@t.com', 'ambiente', 'Empresa 4', 'h4')
$$, '42501', null, 'convite de ambiente sem autor continua barrado');

select lives_ok($$
  update public.invitations set invited_by = null where email = 'novo1@t.com'
$$, 'limpar o autor de um convite de ambiente não é barrado (exclusão da conta)');

select * from finish();
rollback;
