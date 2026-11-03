begin;
create extension if not exists pgtap with schema extensions;

-- Organização isolada do teste (o trigger de bootstrap cria papéis, funis etc.).
insert into public.organizations (id, name) values ('c0000000-0000-0000-0000-00000000000b', 'Org de teste');
select plan(18);

create or replace function pg_temp.mk_user(p_id uuid, p_email text, p_role text default null)
returns void language plpgsql as $$
declare
  v_inv uuid := gen_random_uuid();
begin
  insert into public.invitations (id, organization_id, email, mode, role_id, token_hash)
  values (v_inv, 'c0000000-0000-0000-0000-00000000000b', p_email, 'equipe', (select id from public.roles where organization_id = 'c0000000-0000-0000-0000-00000000000b' and key = coalesce(p_role, 'admin')), 'hash-' || v_inv);
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

-- admin (primeiro), dois vendedores e um colaborador
select pg_temp.mk_user('a0000000-0000-0000-0000-000000000001', 'admin@t.com');
select pg_temp.mk_user('a0000000-0000-0000-0000-000000000002', 'v1@t.com', 'vendedor');
select pg_temp.mk_user('a0000000-0000-0000-0000-000000000003', 'v2@t.com', 'vendedor');
select pg_temp.mk_user('a0000000-0000-0000-0000-000000000004', 'colab@t.com', 'colaborador');

-- CRM: importação pelo vendedor 1 ---------------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-000000000002');
select is(
  (public.import_leads('teste.csv',
     '[{"_line":2,"name":"Vidraçaria Sol","phone_e164":"+5511999990001","place_id":"P1"},
       {"_line":3,"name":"Vidraçaria Sol Filial","phone_e164":"+5511999990001"},
       {"_line":4,"name":"Marmoraria Lua","phone_e164":"+5511999990002","place_id":"P2"}]'::jsonb,
     (select id from public.pipelines order by position limit 1), 'skip', 'Vidraçaria') ->> 'inserted')::int,
  2, 'importação insere 2 e ignora o telefone repetido');
select is((select count(*)::int from public.deals), 2, 'cada lead importado entra no funil');
select is((select count(*)::int from public.leads where owner_id = 'a0000000-0000-0000-0000-000000000002'), 2, 'leads importados pertencem a quem importou');

-- Vendedor 2 não enxerga leads do vendedor 1
select pg_temp.login('a0000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.leads), 0, 'vendedor não vê leads de outro vendedor');
select is((select count(*)::int from public.deals), 0, 'vendedor não vê negócios de outro vendedor');
update public.leads set name = 'invadido';
select pg_temp.login('a0000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.leads where name = 'invadido'), 0, 'vendedor não altera lead alheio');
select is((select count(*)::int from public.leads), 2, 'administrador vê todos os leads');

-- Mover para "Perdido" exige motivo
select pg_temp.login('a0000000-0000-0000-0000-000000000002');
select throws_ok(
  format($$ select public.move_deal(%L, %L, 1) $$,
         (select id from public.deals limit 1),
         (select id from public.stages where kind = 'lost' and pipeline_id = (select pipeline_id from public.deals limit 1))),
  'P0001', 'Informe o motivo da perda.', 'perda sem motivo é recusada');
select lives_ok(
  format($$ select public.move_deal(%L, %L, 1) $$,
         (select id from public.deals limit 1),
         (select id from public.stages where position = 1 and pipeline_id = (select pipeline_id from public.deals limit 1))),
  'vendedor move o próprio negócio');
select ok((select count(*) from public.deal_stage_history) >= 3, 'movimentação gera histórico');

-- Vendedor não troca responsável (sem crm.leads.assign)
select throws_ok(
  $$ update public.leads set owner_id = 'a0000000-0000-0000-0000-000000000003' where name = 'Marmoraria Lua' $$,
  '42501', null, 'vendedor não muda o responsável');

-- Financeiro ------------------------------------------------------------------
select public.ensure_personal_defaults();
select lives_ok($$ select public.create_transactions(jsonb_build_array(jsonb_build_object(
  'scope','pessoal','kind','despesa','description','Aluguel','amount_cents',150000,
  'account_id',(select id from public.financial_accounts where scope='pessoal' limit 1),
  'competence_date','2026-11-01','due_date','2026-11-05'))) $$, 'usuário lança no próprio financeiro pessoal');

select throws_ok($$ select public.create_transactions(jsonb_build_array(jsonb_build_object(
  'scope','empresa','kind','despesa','description','X','amount_cents',100,'competence_date','2026-11-01','due_date','2026-11-01'))) $$,
  '42501', null, 'vendedor não lança no financeiro da empresa');

select pg_temp.login('a0000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.financial_transactions), 0, 'colega não vê o financeiro pessoal de outro');

select pg_temp.login('a0000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.financial_accounts where scope = 'empresa'), 0, 'colaborador não vê contas da empresa');

-- Admin: lê o pessoal só pela RPC auditada
select pg_temp.login('a0000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.financial_transactions where scope = 'pessoal'), 0, 'admin não lê financeiro pessoal direto na tabela');
select is(jsonb_array_length(public.admin_read_personal_finance('a0000000-0000-0000-0000-000000000002', '2026-10-01', '2026-12-31') -> 'transactions'), 1,
          'admin consulta o pessoal pela RPC');
select ok((select count(*) from public.audit_logs where action = 'admin_read_personal_finance') = 1, 'consulta do admin fica auditada');

select * from finish();
rollback;
