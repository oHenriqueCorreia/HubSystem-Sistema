begin;
create extension if not exists pgtap with schema extensions;

-- Organização isolada do teste (o trigger de bootstrap cria papéis, funis etc.).
insert into public.organizations (id, name) values ('c0000000-0000-0000-0000-00000000000a', 'Org de teste');

select plan(26);

-- Helpers de teste --------------------------------------------------------
create or replace function pg_temp.mk_user(p_id uuid, p_email text, p_role text default null)
returns void language plpgsql as $$
declare
  v_inv uuid := gen_random_uuid();
begin
  insert into public.invitations (id, organization_id, email, mode, role_id, token_hash)
  values (v_inv, 'c0000000-0000-0000-0000-00000000000a', p_email, 'equipe', (select id from public.roles where organization_id = 'c0000000-0000-0000-0000-00000000000a' and key = coalesce(p_role, 'admin')), 'hash-' || v_inv);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, jsonb_build_object('invitation_id', v_inv), now(), now());
  update public.invitations set user_id = p_id where id = v_inv;
  perform public.finalize_invitation(v_inv, p_email);
end;
$$;

create or replace function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- Usuários: papel vem do convite ---------------------------------------------
select pg_temp.mk_user('11111111-1111-1111-1111-111111111111', 'admin@teste.com');
select pg_temp.mk_user('22222222-2222-2222-2222-222222222222', 'vendedor@teste.com', 'vendedor');
select pg_temp.mk_user('33333333-3333-3333-3333-333333333333', 'fin@teste.com', 'financeiro');

select is(
  (select r.key from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = '11111111-1111-1111-1111-111111111111'),
  'admin', 'convite de administrador dá o papel Administrador');

select is(
  (select r.key from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = '22222222-2222-2222-2222-222222222222'),
  'vendedor', 'convidado recebe o papel informado no convite');

-- Escopos -------------------------------------------------------------------
select pg_temp.login('22222222-2222-2222-2222-222222222222');

select is(private.perm_scope('crm.leads.read')::text, 'own', 'vendedor lê apenas os próprios leads');
select ok(not private.has_perm('admin.users'), 'vendedor não administra usuários');
select ok(not private.has_perm('finance.company.read'), 'vendedor não vê o financeiro da empresa');
select ok(private.has_perm('finance.personal.manage'), 'vendedor usa o próprio financeiro pessoal');

-- Isolamento das tabelas de acesso ------------------------------------------
select throws_ok(
  $$ insert into public.user_roles (user_id, role_id)
     select '22222222-2222-2222-2222-222222222222', id from public.roles where key = 'admin' $$,
  '42501', null, 'vendedor não consegue se promover a administrador');

select throws_ok(
  $$ update public.profiles set is_active = false where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null, 'vendedor não altera a coluna is_active');

select lives_ok(
  $$ update public.profiles set full_name = 'Vendedor Teste' where id = '22222222-2222-2222-2222-222222222222' $$,
  'vendedor edita o próprio nome');

select is(
  (select count(*)::int from public.profiles where id = '11111111-1111-1111-1111-111111111111' and full_name = 'Vendedor Teste'),
  0, 'vendedor não altera o perfil de outra pessoa');

select is((select count(*)::int from public.user_roles), 1, 'vendedor vê somente os próprios papéis');
select is((select count(*)::int from public.audit_logs), 0, 'vendedor não lê a auditoria');

select throws_ok(
  $$ select public.admin_set_user_active('33333333-3333-3333-3333-333333333333', false) $$,
  '42501', null, 'vendedor não desativa usuários');

-- Administrador ---------------------------------------------------------------
select pg_temp.login('11111111-1111-1111-1111-111111111111');

select is((select count(*)::int from public.user_roles), 3, 'administrador vê os papéis de todos');

select throws_ok(
  $$ select public.admin_set_user_active('11111111-1111-1111-1111-111111111111', false) $$,
  'P0001', 'Você não pode desativar a própria conta.', 'administrador não desativa a própria conta');

select throws_ok(
  $$ delete from public.role_permissions
      where role_id = (select id from public.roles where key = 'admin') and permission_key = 'admin.users' $$,
  'P0001', 'As permissões do papel Administrador não podem ser alteradas.', 'papel Administrador é imutável');

-- A RLS já esconde papéis do sistema do DELETE (0 linhas); o trigger é a 2ª barreira.
delete from public.roles where key = 'vendedor';
select is((select count(*)::int from public.roles where key = 'vendedor'), 1, 'papel do sistema não pode ser excluído');

-- Exceções por usuário
insert into public.user_permission_overrides (user_id, permission_key, effect)
values ('22222222-2222-2222-2222-222222222222', 'crm.pipeline.move', 'deny'),
       ('22222222-2222-2222-2222-222222222222', 'crm.leads.export', 'grant');

select pg_temp.login('22222222-2222-2222-2222-222222222222');
select ok(not private.has_perm('crm.pipeline.move'), 'exceção "bloquear" remove a permissão do papel');
select ok(private.has_perm('crm.leads.export'), 'exceção "liberar" adiciona permissão fora do papel');

-- Desativação
select pg_temp.login('11111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ select public.admin_set_user_active('22222222-2222-2222-2222-222222222222', false) $$,
  'administrador desativa um usuário');

select ok(
  (select count(*) from public.audit_logs where entity_type = 'profiles' and entity_id = '22222222-2222-2222-2222-222222222222') > 0,
  'desativação fica registrada na auditoria');

select pg_temp.login('22222222-2222-2222-2222-222222222222');
select ok(private.org_id() is null and private.perm_scope('crm.leads.read') is null,
  'usuário desativado perde todo acesso');

-- Último administrador
select pg_temp.login('11111111-1111-1111-1111-111111111111');
set constraints all immediate;
select throws_ok(
  $$ delete from public.user_roles
      where user_id = '11111111-1111-1111-1111-111111111111'
        and role_id = (select id from public.roles where key = 'admin') $$,
  'P0001', 'É necessário manter ao menos um administrador ativo.', 'não é possível remover o último administrador');

-- Conta nova sem convite é recusada -------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'novo@teste.com', '{"organization_id":"c0000000-0000-0000-0000-00000000000a"}', now(), now()) $$,
  '42501', 'Acesso somente por convite.', 'cadastro sem convite é recusado, mesmo apontando para uma organização');
select ok(public.rate_limit_hit('teste:1', 2, 60) and public.rate_limit_hit('teste:1', 2, 60) and not public.rate_limit_hit('teste:1', 2, 60),
  'rate limit bloqueia a partir do limite');

-- Anônimo
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select * from public.profiles $$, '42501', null, 'anônimo não acessa perfis');

select * from finish();
rollback;
