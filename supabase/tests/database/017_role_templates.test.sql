begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into public.organizations (id, name) values ('c9000000-0000-4000-8000-00000000000a', 'Modelos A');
insert into public.roles (id, organization_id, key, name) values
  ('c9000000-0000-4000-8000-0000000000e1', 'c9000000-0000-4000-8000-00000000000a', 'rh_t', 'RH');
insert into public.role_permissions (role_id, permission_key, scope) values
  ('c9000000-0000-4000-8000-0000000000e1', 'admin.roles', 'all'), ('c9000000-0000-4000-8000-0000000000e1', 'tasks.read', 'own'),
  ('c9000000-0000-4000-8000-0000000000e1', 'tasks.create', 'own'), ('c9000000-0000-4000-8000-0000000000e1', 'tasks.update', 'own'),
  ('c9000000-0000-4000-8000-0000000000e1', 'clients.read', 'own'), ('c9000000-0000-4000-8000-0000000000e1', 'calendar.read', 'own'),
  ('c9000000-0000-4000-8000-0000000000e1', 'calendar.manage', 'own'), ('c9000000-0000-4000-8000-0000000000e1', 'finance.personal.manage', 'own');

create or replace function pg_temp.mk_user(p_id uuid, p_email text, p_role uuid)
returns void language plpgsql as $$
declare
  v_inv uuid := gen_random_uuid();
begin
  insert into public.invitations (id, organization_id, email, mode, role_id, token_hash)
  values (v_inv, 'c9000000-0000-4000-8000-00000000000a', p_email, 'equipe', p_role, 'hash-' || v_inv);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, jsonb_build_object('invitation_id', v_inv), now(), now());
  update public.invitations set user_id = p_id where id = v_inv;
  perform public.finalize_invitation(v_inv, split_part(p_email, '@', 1));
end;
$$;
select pg_temp.mk_user('c9000000-0000-4000-8000-000000000001', 'adm@modelos.t',
  (select id from public.roles where organization_id = 'c9000000-0000-4000-8000-00000000000a' and key = 'admin'));
select pg_temp.mk_user('c9000000-0000-4000-8000-000000000002', 'rh@modelos.t', 'c9000000-0000-4000-8000-0000000000e1');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c9000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from public.role_templates), 6, 'seis modelos disponíveis para quem está logado');
select lives_ok($$ select public.admin_create_role_from_template('social_media', 'Social media', null) $$, 'administrador cria papel a partir do modelo');
select is((select count(*)::int from public.role_permissions rp join public.roles r on r.id = rp.role_id
           where r.organization_id = 'c9000000-0000-4000-8000-00000000000a' and r.name = 'Social media'), 10, 'papel criado tem as permissões do modelo');
select is((select scope::text from public.role_permissions rp join public.roles r on r.id = rp.role_id
           where r.name = 'Social media' and r.organization_id = 'c9000000-0000-4000-8000-00000000000a' and rp.permission_key = 'content.publish'), 'own',
  'escopo do modelo é mantido');

-- RH (admin.roles, sem ser administrador) só cria modelos que cabem no que ele tem.
select set_config('request.jwt.claims', '{"sub":"c9000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.admin_create_role_from_template('desenvolvimento_web', 'Web', null) $$, 'RH cria modelo que só usa permissões que ele tem');
select throws_ok($$ select public.admin_create_role_from_template('gestor_operacional', 'Gestão', null) $$, '42501', null,
  'RH não cria modelo com permissões que ele não tem');
select is((select count(*)::int from public.roles where organization_id = 'c9000000-0000-4000-8000-00000000000a' and name = 'Gestão'), 0,
  'tentativa barrada não deixa papel pela metade');

select * from finish();
rollback;
