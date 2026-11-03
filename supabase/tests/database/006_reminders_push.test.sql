begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into public.organizations (id, name) values ('d0000000-0000-0000-0000-00000000000a', 'Org lembretes');

create or replace function pg_temp.mk_user(p_id uuid, p_email text, p_role text)
returns void language plpgsql as $$
declare
  v_inv uuid := gen_random_uuid();
  v_org uuid := 'd0000000-0000-0000-0000-00000000000a';
begin
  insert into public.invitations (id, organization_id, email, mode, role_id, token_hash)
  values (v_inv, v_org, p_email, 'equipe', (select id from public.roles where organization_id = v_org and key = p_role), 'hash-' || v_inv);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, jsonb_build_object('invitation_id', v_inv), now(), now());
  update public.invitations set user_id = p_id where id = v_inv;
  perform public.finalize_invitation(v_inv, p_email);
end;
$$;

select pg_temp.mk_user('d0000000-0000-0000-0000-000000000001', 'dono@lembrete.com', 'admin');
select pg_temp.mk_user('d0000000-0000-0000-0000-000000000002', 'colab@lembrete.com', 'colaborador');

create or replace function pg_temp.kinds(p_user uuid) returns text[] language sql as $$
  select coalesce(array_agg(kind order by kind), '{}') from public.notifications where user_id = p_user;
$$;

-- Tarefas: dentro da antecedência avisa; longe, não; atrasada, sim.
insert into public.tasks (organization_id, title, owner_id, due_at, has_time) values
  ('d0000000-0000-0000-0000-00000000000a', 'Em breve', 'd0000000-0000-0000-0000-000000000001', now() + interval '30 minutes', true),
  ('d0000000-0000-0000-0000-00000000000a', 'Longe', 'd0000000-0000-0000-0000-000000000001', now() + interval '6 hours', true),
  ('d0000000-0000-0000-0000-00000000000a', 'Atrasada', 'd0000000-0000-0000-0000-000000000001', now() - interval '2 hours', true);
-- Agenda: vários lembretes por evento; lista vazia = sem lembrete.
insert into public.calendar_events (organization_id, title, kind, starts_at, ends_at, owner_id, reminder_minutes) values
  ('d0000000-0000-0000-0000-00000000000a', 'Reunião perto', 'reuniao', now() + interval '10 minutes', now() + interval '1 hour', 'd0000000-0000-0000-0000-000000000001', '{60,15}'),
  ('d0000000-0000-0000-0000-00000000000a', 'Reunião longe', 'reuniao', now() + interval '3 hours', now() + interval '4 hours', 'd0000000-0000-0000-0000-000000000001', '{60,15}'),
  ('d0000000-0000-0000-0000-00000000000a', 'Sem lembrete', 'reuniao', now() + interval '5 minutes', now() + interval '1 hour', 'd0000000-0000-0000-0000-000000000001', '{}');

select private.generate_reminders('d0000000-0000-0000-0000-000000000001');

select is(pg_temp.kinds('d0000000-0000-0000-0000-000000000001'), array['evento_breve', 'tarefa_atrasada', 'tarefa_breve'],
  'gera só o que está perto do horário ou atrasado');
select ok((select body is null and title like 'Tarefa às %: Em breve' from public.notifications where kind = 'tarefa_breve' and user_id = 'd0000000-0000-0000-0000-000000000001'),
  'o título traz o horário da tarefa');

select private.generate_reminders('d0000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.notifications where user_id = 'd0000000-0000-0000-0000-000000000001'), 3, 'rodar de novo não repete');

-- Preferência: categoria desligada não gera.
update public.profiles set preferences = jsonb_build_object('notificacoes', jsonb_build_object('tarefas', false)) where id = 'd0000000-0000-0000-0000-000000000002';
insert into public.tasks (organization_id, title, owner_id, due_at, has_time) values
  ('d0000000-0000-0000-0000-00000000000a', 'Da colaboradora', 'd0000000-0000-0000-0000-000000000002', now() + interval '10 minutes', true);
select private.generate_reminders('d0000000-0000-0000-0000-000000000002');
select is(pg_temp.kinds('d0000000-0000-0000-0000-000000000002'), '{}'::text[], 'categoria desligada não gera lembrete');

-- Permissão: conta da empresa só para quem lê o financeiro da empresa.
insert into public.financial_transactions (organization_id, scope, kind, description, amount_cents, competence_date, due_date) values
  ('d0000000-0000-0000-0000-00000000000a', 'empresa', 'despesa', 'Aluguel', 150000, (now() at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::date - 1);
select private.generate_reminders();
select is((select count(*)::int from public.notifications where kind = 'pagar' and user_id = 'd0000000-0000-0000-0000-000000000001'),
  case when (now() at time zone 'America/Sao_Paulo')::time >= time '08:00' then 1 else 0 end, 'administrador recebe a conta da empresa a partir das 8h');
select is((select count(*)::int from public.notifications where kind = 'pagar' and user_id = 'd0000000-0000-0000-0000-000000000002'), 0, 'colaborador não recebe conta da empresa');

-- Avisos na hora: tarefa atribuída por outra pessoa.
select set_config('request.jwt.claims', json_build_object('sub', 'd0000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.tasks (organization_id, title, owner_id) values ('d0000000-0000-0000-0000-00000000000a', 'Para você', 'd0000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.notifications where kind = 'tarefa_atribuida' and user_id = 'd0000000-0000-0000-0000-000000000002'), 1, 'tarefa atribuída avisa quem recebeu');
insert into public.tasks (organization_id, title, owner_id) values ('d0000000-0000-0000-0000-00000000000a', 'Minha', 'd0000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.notifications where kind = 'tarefa_atribuida' and user_id = 'd0000000-0000-0000-0000-000000000001'), 0, 'tarefa criada para si mesmo não avisa');
select set_config('request.jwt.claims', '', true);

-- Envio: só com aparelho inscrito, e cada notificação sai uma vez.
select is((select count(*)::int from public.push_claim_pending() c where c.user_id = 'd0000000-0000-0000-0000-000000000001'), 0, 'sem aparelho inscrito nada é reservado');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('d0000000-0000-0000-0000-000000000001', 'https://push.example/1', 'k', 'a');
select ok((select count(*)::int > 0 from public.push_claim_pending() c where c.user_id = 'd0000000-0000-0000-0000-000000000001'), 'com aparelho inscrito reserva o pendente');
select is((select count(*)::int from public.push_claim_pending() c where c.user_id = 'd0000000-0000-0000-0000-000000000001'), 0, 'não envia a mesma notificação duas vezes');

-- Segurança: inscrição é de cada um; rotina de envio é só do servidor.
select set_config('role', 'authenticated', true), set_config('request.jwt.claims', json_build_object('sub', 'd0000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.push_subscriptions), 0, 'um usuário não vê o aparelho do outro');
select throws_ok($$ select public.push_claim_pending() $$, '42501', null, 'usuário comum não aciona o envio');

select * from finish();
rollback;
