begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- Empresa com Administrador (A), designer associado direto (D), designer de squad (E),
-- colaborador sem clients.read (F) e gestor de pessoas sem ser administrador (G).
insert into public.organizations (id, name) values
  ('c1000000-0000-0000-0000-00000000000a', 'Escopo A'),
  ('c1000000-0000-0000-0000-00000000000b', 'Escopo B');
insert into public.roles (id, organization_id, key, name) values
  ('c1000000-0000-0000-0000-0000000000d1', 'c1000000-0000-0000-0000-00000000000a', 'designer_t', 'Designer'),
  ('c1000000-0000-0000-0000-0000000000d2', 'c1000000-0000-0000-0000-00000000000a', 'gestor_pessoas_t', 'Gestor de pessoas');
insert into public.role_permissions (role_id, permission_key, scope) values
  ('c1000000-0000-0000-0000-0000000000d1', 'clients.read', 'own'),
  ('c1000000-0000-0000-0000-0000000000d1', 'tasks.read', 'own'),
  ('c1000000-0000-0000-0000-0000000000d1', 'tasks.update', 'own'),
  ('c1000000-0000-0000-0000-0000000000d1', 'calendar.read', 'own'),
  ('c1000000-0000-0000-0000-0000000000d2', 'admin.users', 'all'),
  ('c1000000-0000-0000-0000-0000000000d2', 'clients.read', 'all');

create or replace function pg_temp.mk_user(p_id uuid, p_email text, p_role uuid)
returns void language plpgsql as $$
declare
  v_inv uuid := gen_random_uuid();
begin
  insert into public.invitations (id, organization_id, email, mode, role_id, token_hash)
  values (v_inv, 'c1000000-0000-0000-0000-00000000000a', p_email, 'equipe', p_role, 'hash-' || v_inv);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, jsonb_build_object('invitation_id', v_inv), now(), now());
  update public.invitations set user_id = p_id where id = v_inv;
  perform public.finalize_invitation(v_inv, split_part(p_email, '@', 1));
end;
$$;
create or replace function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

select pg_temp.mk_user('c1000000-0000-0000-0000-000000000001', 'adm@escopo.t',
  (select id from public.roles where organization_id = 'c1000000-0000-0000-0000-00000000000a' and key = 'admin'));
select pg_temp.mk_user('c1000000-0000-0000-0000-000000000002', 'd@escopo.t', 'c1000000-0000-0000-0000-0000000000d1');
select pg_temp.mk_user('c1000000-0000-0000-0000-000000000003', 'e@escopo.t', 'c1000000-0000-0000-0000-0000000000d1');
select pg_temp.mk_user('c1000000-0000-0000-0000-000000000004', 'f@escopo.t',
  (select id from public.roles where organization_id = 'c1000000-0000-0000-0000-00000000000a' and key = 'colaborador'));
select pg_temp.mk_user('c1000000-0000-0000-0000-000000000005', 'g@escopo.t', 'c1000000-0000-0000-0000-0000000000d2');

-- Dois clientes do Administrador (X e Y) e um de outra empresa (Z).
insert into public.leads (id, organization_id, name, owner_id) values
  ('c1000000-0000-0000-0000-0000000000a1', 'c1000000-0000-0000-0000-00000000000a', 'Padaria X', 'c1000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-0000000000a2', 'c1000000-0000-0000-0000-00000000000a', 'Oficina Y', 'c1000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-0000000000a3', 'c1000000-0000-0000-0000-00000000000b', 'Loja Z', null);
insert into public.clients (id, organization_id, lead_id, owner_id) values
  ('c1000000-0000-0000-0000-0000000000c1', 'c1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-0000000000a1', 'c1000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-0000000000c2', 'c1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-0000000000a2', 'c1000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-0000000000c3', 'c1000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-0000000000a3', null);
insert into public.tasks (id, organization_id, title, owner_id, client_id) values
  ('c1000000-0000-0000-0000-0000000000e1', 'c1000000-0000-0000-0000-00000000000a', 'Arte X', 'c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-0000000000c1'),
  ('c1000000-0000-0000-0000-0000000000e2', 'c1000000-0000-0000-0000-00000000000a', 'Arte Y', 'c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-0000000000c2');
insert into public.calendar_events (id, organization_id, title, starts_at, ends_at, owner_id, client_id) values
  ('c1000000-0000-0000-0000-0000000000f1', 'c1000000-0000-0000-0000-00000000000a', 'Reunião X', now(), now() + interval '1 hour', 'c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-0000000000c1');
insert into public.contracts (organization_id, client_id, title, amount_cents, start_date, owner_id) values
  ('c1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-0000000000c1', 'Gestão X', 100000, '2026-11-01', 'c1000000-0000-0000-0000-000000000001');
insert into public.teams (id, organization_id, name) values
  ('c1000000-0000-0000-0000-0000000000b1', 'c1000000-0000-0000-0000-00000000000a', 'Squad Y');

set local role authenticated;

-- Sem associação, nada muda: o designer só vê o que é dele.
select pg_temp.as_user('c1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.clients), 0, 'sem associação o designer não vê clientes alheios');
select is((select count(*)::int from public.tasks), 0, 'sem associação o designer não vê tarefas alheias');

-- O Administrador associa: D direto ao cliente X; E pelo squad ligado ao cliente Y; F direto ao X.
select pg_temp.as_user('c1000000-0000-0000-0000-000000000001');
insert into public.client_members (client_id, user_id, role_label) values
  ('c1000000-0000-0000-0000-0000000000c1', 'c1000000-0000-0000-0000-000000000002', 'Designer'),
  ('c1000000-0000-0000-0000-0000000000c1', 'c1000000-0000-0000-0000-000000000004', 'Apoio');
insert into public.team_members (team_id, user_id) values ('c1000000-0000-0000-0000-0000000000b1', 'c1000000-0000-0000-0000-000000000003');
insert into public.team_clients (team_id, client_id) values ('c1000000-0000-0000-0000-0000000000b1', 'c1000000-0000-0000-0000-0000000000c2');
select ok(exists (select 1 from public.audit_logs where entity_type = 'client_members' and action = 'insert'), 'associação fica na auditoria');
select throws_ok($$ insert into public.client_members (client_id, user_id) values ('c1000000-0000-0000-0000-0000000000c3', 'c1000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'não associa cliente de outra empresa');

select pg_temp.as_user('c1000000-0000-0000-0000-000000000002');
select is((select array_agg(id::text) from public.clients), array['c1000000-0000-0000-0000-0000000000c1'], 'designer vê só o cliente associado');
select is((select name from public.leads where id = 'c1000000-0000-0000-0000-0000000000a1'), 'Padaria X', 'designer vê o nome (lead) do cliente associado');
select is((select count(*)::int from public.leads where id = 'c1000000-0000-0000-0000-0000000000a2'), 0, 'designer não vê o lead de outro cliente');
select is((select array_agg(title) from public.tasks), array['Arte X'], 'designer vê só as tarefas do cliente associado');
update public.tasks set status = 'em_andamento' where id = 'c1000000-0000-0000-0000-0000000000e1';
select is((select status::text from public.tasks where id = 'c1000000-0000-0000-0000-0000000000e1'), 'em_andamento', 'designer edita tarefa do cliente associado');
update public.tasks set title = 'invadida' where id = 'c1000000-0000-0000-0000-0000000000e2';
select is((select count(*)::int from public.tasks where title = 'invadida'), 0, 'designer não edita tarefa de outro cliente');
select is((select count(*)::int from public.calendar_events), 1, 'designer vê a reunião do cliente associado');
select is((select count(*)::int from public.contracts), 0, 'sem contracts.read a associação não mostra contratos');
select is((select count(*)::int from public.client_members where client_id = 'c1000000-0000-0000-0000-0000000000c1'), 2, 'designer vê quem mais trabalha no cliente');
select throws_ok($$ insert into public.client_members (client_id, user_id) values ('c1000000-0000-0000-0000-0000000000c2', 'c1000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'designer não se associa a outro cliente');

select pg_temp.as_user('c1000000-0000-0000-0000-000000000003');
select is((select array_agg(id::text) from public.clients), array['c1000000-0000-0000-0000-0000000000c2'], 'membro do squad vê o cliente do squad');
select is((select array_agg(title) from public.tasks), array['Arte Y'], 'membro do squad vê as tarefas do cliente do squad');

-- Associação não substitui a permissão do módulo.
select pg_temp.as_user('c1000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.clients), 0, 'sem clients.read a associação não mostra o cliente');
select is((select count(*)::int from public.tasks where client_id = 'c1000000-0000-0000-0000-0000000000c1'), 1, 'com tasks.read vê as tarefas do cliente associado');

-- Gestor de pessoas (não administrador): associa outros, nunca a si mesmo nem ao próprio squad.
select pg_temp.as_user('c1000000-0000-0000-0000-000000000005');
select lives_ok($$ insert into public.client_members (client_id, user_id) values ('c1000000-0000-0000-0000-0000000000c2', 'c1000000-0000-0000-0000-000000000004') $$,
  'gestor de pessoas associa outra pessoa');
select throws_ok($$ insert into public.client_members (client_id, user_id) values ('c1000000-0000-0000-0000-0000000000c2', 'c1000000-0000-0000-0000-000000000005') $$,
  '42501', null, 'gestor de pessoas não se associa');
select throws_ok($$ insert into public.team_members (team_id, user_id) values ('c1000000-0000-0000-0000-0000000000b1', 'c1000000-0000-0000-0000-000000000005') $$,
  '42501', null, 'gestor de pessoas não se coloca num squad');
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.team_members (team_id, user_id) values ('c1000000-0000-0000-0000-0000000000b1', 'c1000000-0000-0000-0000-000000000005');
set local role authenticated;
select pg_temp.as_user('c1000000-0000-0000-0000-000000000005');
select throws_ok($$ insert into public.team_clients (team_id, client_id) values ('c1000000-0000-0000-0000-0000000000b1', 'c1000000-0000-0000-0000-0000000000c1') $$,
  '42501', null, 'gestor de pessoas não liga clientes ao próprio squad');

select * from finish();
rollback;
