begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- Organizações próprias do teste: não dependem dos usuários já existentes no banco.
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A teste'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B teste');

create or replace function pg_temp.mk_user(p_id uuid, p_email text, p_org uuid, p_role text default null)
returns void language plpgsql as $$
declare
  v_inv uuid := gen_random_uuid();
begin
  insert into public.invitations (id, organization_id, email, mode, role_id, token_hash)
  values (v_inv, p_org, p_email, 'equipe', (select id from public.roles where organization_id = p_org and key = coalesce(p_role, 'admin')), 'hash-' || v_inv);
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
create or replace function pg_temp.logout() returns void language sql as $$
  select set_config('role', 'none', true), set_config('request.jwt.claims', '', true);
$$;

-- Org A: admin (primeiro usuário) e colaborador. Org B: admin.
select pg_temp.mk_user('b0000000-0000-0000-0000-000000000001', 'admin-a@t.com', 'b0000000-0000-0000-0000-00000000000a');
select pg_temp.mk_user('b0000000-0000-0000-0000-000000000002', 'colab-a@t.com', 'b0000000-0000-0000-0000-00000000000a', 'colaborador');
select pg_temp.mk_user('b0000000-0000-0000-0000-000000000003', 'admin-b@t.com', 'b0000000-0000-0000-0000-00000000000b');

select pg_temp.login('b0000000-0000-0000-0000-000000000001');
insert into public.tasks (id, title) values ('b1000000-0000-0000-0000-000000000001', 'Tarefa do admin');
insert into public.tasks (id, title, owner_id) values ('b1000000-0000-0000-0000-000000000002', 'Tarefa do colaborador', 'b0000000-0000-0000-0000-000000000002');
insert into public.calendar_events (id, title, starts_at, ends_at)
  values ('b2000000-0000-0000-0000-000000000001', 'Reunião', now(), now() + interval '1 hour');
insert into public.financial_transactions (id, scope, kind, description, amount_cents, competence_date, due_date)
  values ('b3000000-0000-0000-0000-000000000001', 'empresa', 'despesa', 'Hospedagem', 5000, current_date, current_date);
insert into public.financial_transactions (id, scope, owner_user_id, kind, description, amount_cents, competence_date, due_date)
  values ('b3000000-0000-0000-0000-000000000002', 'pessoal', 'b0000000-0000-0000-0000-000000000001', 'despesa', 'Mercado', 3000, current_date, current_date);

-- Administrador exclui (lixeira) -----------------------------------------------
select lives_ok($$ update public.tasks set deleted_at = now() where id = 'b1000000-0000-0000-0000-000000000001' $$,
  'administrador exclui tarefa');
select lives_ok($$ update public.calendar_events set deleted_at = now() where id = 'b2000000-0000-0000-0000-000000000001' $$,
  'administrador exclui evento');
select lives_ok($$ update public.financial_transactions set deleted_at = now() where id = 'b3000000-0000-0000-0000-000000000001' $$,
  'administrador exclui lançamento da empresa');
select lives_ok($$ update public.financial_transactions set deleted_at = now() where id = 'b3000000-0000-0000-0000-000000000002' $$,
  'dono exclui lançamento pessoal');
select is((select count(*)::int from public.tasks where deleted_at is null), 1, 'tarefa excluída sai da lista');

-- Restaurar
select lives_ok($$ update public.tasks set deleted_at = null where id = 'b1000000-0000-0000-0000-000000000001' $$,
  'administrador restaura tarefa');
select is((select count(*)::int from public.tasks where deleted_at is null), 2, 'tarefa restaurada volta à lista');

-- Colaborador (sem tasks.delete) não exclui nem vê a lixeira ------------------
select pg_temp.login('b0000000-0000-0000-0000-000000000002');
select throws_ok($$ update public.tasks set deleted_at = now() where id = 'b1000000-0000-0000-0000-000000000002' $$,
  '42501', null, 'colaborador não exclui tarefa');
select is((select count(*)::int from public.calendar_events), 0, 'colaborador não vê evento excluído de outra pessoa');
select is((select count(*)::int from public.financial_transactions), 0, 'colaborador não vê lançamentos excluídos');

-- Outra organização: nada visível, nada alterável ----------------------------
select pg_temp.login('b0000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.tasks), 0, 'admin de outra organização não vê tarefas');
select is((select count(*)::int from public.calendar_events), 0, 'admin de outra organização não vê a lixeira');
update public.tasks set deleted_at = now() where id = 'b1000000-0000-0000-0000-000000000002';
select pg_temp.logout();
select ok((select deleted_at is null from public.tasks where id = 'b1000000-0000-0000-0000-000000000002'),
  'admin de outra organização não exclui tarefa');
select is((select count(*)::int from public.audit_logs where entity_type = 'tasks' and action = 'soft_delete'
             and entity_id = 'b1000000-0000-0000-0000-000000000001'), 1, 'exclusão fica registrada na auditoria');

select * from finish();
rollback;
