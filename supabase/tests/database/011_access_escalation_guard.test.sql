begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- Administrador (A), gerente de pessoas sem ser administrador (B) e colaborador (C).
insert into public.organizations (id, name) values ('b1000000-0000-0000-0000-00000000000a', 'Acesso A');
insert into public.roles (id, organization_id, key, name) values
  ('b1000000-0000-0000-0000-0000000000f1', 'b1000000-0000-0000-0000-00000000000a', 'gerente_pessoas', 'Gerente de pessoas');
insert into public.role_permissions (role_id, permission_key, scope) values
  ('b1000000-0000-0000-0000-0000000000f1', 'admin.users', 'all'),
  ('b1000000-0000-0000-0000-0000000000f1', 'admin.roles', 'all'),
  ('b1000000-0000-0000-0000-0000000000f1', 'tasks.read', 'own');

create or replace function pg_temp.mk_user(p_id uuid, p_email text, p_role uuid)
returns void language plpgsql as $$
declare
  v_inv uuid := gen_random_uuid();
begin
  insert into public.invitations (id, organization_id, email, mode, role_id, token_hash)
  values (v_inv, 'b1000000-0000-0000-0000-00000000000a', p_email, 'equipe', p_role, 'hash-' || v_inv);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, jsonb_build_object('invitation_id', v_inv), now(), now());
  update public.invitations set user_id = p_id where id = v_inv;
  perform public.finalize_invitation(v_inv, split_part(p_email, '@', 1));
end;
$$;
create or replace function pg_temp.role(p_key text) returns uuid language sql as $$
  select id from public.roles where organization_id = 'b1000000-0000-0000-0000-00000000000a' and key = p_key;
$$;

select pg_temp.mk_user('b1000000-0000-0000-0000-000000000001', 'adm@acesso.t', pg_temp.role('admin'));
select pg_temp.mk_user('b1000000-0000-0000-0000-000000000002', 'gerente@acesso.t', 'b1000000-0000-0000-0000-0000000000f1');
select pg_temp.mk_user('b1000000-0000-0000-0000-000000000003', 'colab@acesso.t', pg_temp.role('colaborador'));

-- Notificação respeita "negar" individual.
insert into public.user_permission_overrides (user_id, permission_key, effect)
values ('b1000000-0000-0000-0000-000000000003', 'tasks.read', 'deny');
select is(public.notify_users('b1000000-0000-0000-0000-00000000000a', 'tasks.read', 'teste', 'Aviso', null, null, 'k1'), 2,
  'notificação vai só para quem tem a permissão efetiva (negar exclui)');
select is((select count(*)::int from public.notifications where user_id = 'b1000000-0000-0000-0000-000000000003' and dedupe_key = 'k1'), 0,
  'colaborador com "negar" não recebe');
delete from public.user_permission_overrides where user_id = 'b1000000-0000-0000-0000-000000000003';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select throws_ok($$ select public.admin_set_user_role('b1000000-0000-0000-0000-000000000002', pg_temp.role('admin')) $$,
  '42501', null, 'gerente não se dá o papel Administrador');
select throws_ok($$ insert into public.user_roles (user_id, role_id) values ('b1000000-0000-0000-0000-000000000002', pg_temp.role('financeiro')) $$,
  '42501', null, 'gerente não acrescenta papel a si mesmo direto na tabela');
select throws_ok($$ insert into public.user_permission_overrides (user_id, permission_key, effect, scope) values ('b1000000-0000-0000-0000-000000000002', 'finance.company.read', 'grant', 'all') $$,
  '42501', null, 'gerente não se concede permissão por exceção');
select throws_ok($$ insert into public.role_permissions (role_id, permission_key, scope) values ('b1000000-0000-0000-0000-0000000000f1', 'finance.company.read', 'all') $$,
  '42501', null, 'gerente não amplia o próprio papel');
select throws_ok($$ select public.admin_set_user_role('b1000000-0000-0000-0000-000000000003', pg_temp.role('admin')) $$,
  '42501', null, 'gerente não promove outra pessoa a Administrador');
select throws_ok($$ select public.admin_set_user_role('b1000000-0000-0000-0000-000000000003', pg_temp.role('financeiro')) $$,
  '42501', null, 'gerente não atribui papel com permissões que não tem');
select throws_ok($$ insert into public.user_permission_overrides (user_id, permission_key, effect, scope) values ('b1000000-0000-0000-0000-000000000003', 'tasks.read', 'grant', 'all') $$,
  '42501', null, 'gerente não concede escopo maior que o próprio');
select lives_ok($$ insert into public.user_permission_overrides (user_id, permission_key, effect, scope) values ('b1000000-0000-0000-0000-000000000003', 'tasks.read', 'grant', 'own') $$,
  'gerente concede o que tem, no mesmo escopo');
select lives_ok($$ insert into public.user_permission_overrides (user_id, permission_key, effect) values ('b1000000-0000-0000-0000-000000000003', 'calendar.read', 'deny') $$,
  'gerente pode restringir (negar) outra pessoa');
select throws_ok($$ insert into public.user_permission_overrides (user_id, permission_key, effect) values ('b1000000-0000-0000-0000-000000000001', 'admin.audit', 'deny') $$,
  '42501', null, 'gerente não mexe no acesso de um administrador');
select throws_ok($$ select public.admin_set_user_active('b1000000-0000-0000-0000-000000000001', false) $$,
  '42501', null, 'gerente não desativa um administrador');

-- Administrador continua livre.
select set_config('request.jwt.claims', '{"sub":"b1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.admin_set_user_role('b1000000-0000-0000-0000-000000000003', pg_temp.role('financeiro')) $$,
  'administrador atribui qualquer papel');
select lives_ok($$ insert into public.role_permissions (role_id, permission_key, scope) values ('b1000000-0000-0000-0000-0000000000f1', 'finance.company.read', 'all') $$,
  'administrador amplia qualquer papel personalizado');

select * from finish();
rollback;
