begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- Duas pessoas de verdade numa organização: empresa e pessoal com as permissões reais.
insert into public.organizations (id, name) values ('a1000000-0000-0000-0000-00000000000a', 'Finanças A');
create or replace function pg_temp.mk_admin(p_id uuid, p_email text)
returns void language plpgsql as $$
declare
  v_inv uuid := gen_random_uuid();
  v_role uuid;
begin
  select id into v_role from public.roles where organization_id = 'a1000000-0000-0000-0000-00000000000a' and key = 'admin';
  insert into public.invitations (id, organization_id, email, mode, role_id, token_hash)
  values (v_inv, 'a1000000-0000-0000-0000-00000000000a', p_email, 'equipe', v_role, 'hash-' || v_inv);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, jsonb_build_object('invitation_id', v_inv), now(), now());
  update public.invitations set user_id = p_id where id = v_inv;
  perform public.finalize_invitation(v_inv, 'Admin');
end;
$$;
select pg_temp.mk_admin('a1000000-0000-0000-0000-000000000001', 'dona-financas@t.com');
select pg_temp.mk_admin('a1000000-0000-0000-0000-000000000002', 'outra-financas@t.com');

insert into public.financial_accounts (id, organization_id, scope, name, type) values
  ('a1000000-0000-0000-0000-000000000011', 'a1000000-0000-0000-0000-00000000000a', 'empresa', 'Caixa empresa', 'corrente');
insert into public.financial_accounts (id, organization_id, scope, owner_user_id, name, type) values
  ('a1000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-00000000000a', 'pessoal', 'a1000000-0000-0000-0000-000000000001', 'Minha conta', 'corrente');
insert into public.financial_categories (id, organization_id, scope, owner_user_id, name, kind) values
  ('a1000000-0000-0000-0000-000000000021', 'a1000000-0000-0000-0000-00000000000a', 'pessoal', 'a1000000-0000-0000-0000-000000000001', 'Mercado', 'despesa');
insert into public.financial_transactions (id, organization_id, scope, kind, description, amount_cents, account_id, competence_date, due_date, status, paid_at) values
  ('a1000000-0000-0000-0000-000000000031', 'a1000000-0000-0000-0000-00000000000a', 'empresa', 'despesa', 'Compra errada', 15000, 'a1000000-0000-0000-0000-000000000011', '2026-11-01', '2026-11-01', 'pago', '2026-11-01'),
  ('a1000000-0000-0000-0000-000000000032', 'a1000000-0000-0000-0000-00000000000a', 'empresa', 'receita', 'Mensalidade', 50000, 'a1000000-0000-0000-0000-000000000011', '2026-11-05', '2026-11-05', 'previsto', null);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok($$ select public.transfer_transaction_scope('a1000000-0000-0000-0000-000000000031', null, null) $$, 'P0001', null, 'pago precisa de conta de destino');
select throws_ok($$ select public.transfer_transaction_scope('a1000000-0000-0000-0000-000000000031', null, 'a1000000-0000-0000-0000-000000000011') $$, 'P0001', null, 'conta da origem não serve no destino');
select is(public.transfer_transaction_scope('a1000000-0000-0000-0000-000000000031', 'a1000000-0000-0000-0000-000000000021', 'a1000000-0000-0000-0000-000000000012')::text, 'pessoal', 'lançamento vai para o pessoal');
select is((select scope::text from public.financial_transactions where id = 'a1000000-0000-0000-0000-000000000031'), 'pessoal', 'área do lançamento mudou');
select is((select count(*)::int from public.financial_transactions where description = 'Compra errada'), 1, 'transferir não duplica');
select is((select previous_account from public.financial_scope_transfers where txn_id = 'a1000000-0000-0000-0000-000000000031'), 'Caixa empresa', 'guarda a classificação anterior');
select is((select moved_by from public.financial_scope_transfers where txn_id = 'a1000000-0000-0000-0000-000000000031'), 'a1000000-0000-0000-0000-000000000001'::uuid, 'guarda quem transferiu');
select is((select action from public.financial_txn_events where txn_id = 'a1000000-0000-0000-0000-000000000031' order by id desc limit 1), 'transferencia', 'histórico registra a transferência');

-- A outra pessoa não vê o que agora é pessoal, nem transfere.
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.financial_transactions where id = 'a1000000-0000-0000-0000-000000000031'), 0, 'lançamento pessoal some para outra pessoa');
select throws_ok($$ select public.transfer_transaction_scope('a1000000-0000-0000-0000-000000000031', null, null) $$, 'P0002', null, 'outra pessoa não transfere o pessoal alheio');

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- Extrato: criar, conciliar sem duplicar e ignorar.
select is((public.commit_statement('extrato.ofx', 'ofx', '[
  {"action":"conciliar","txn_id":"a1000000-0000-0000-0000-000000000032","date":"2026-11-06","amount_cents":50000,"direction":"entrada","description":"PIX CLIENTE","hash":"h1","account_id":"a1000000-0000-0000-0000-000000000011"},
  {"action":"criar","scope":"pessoal","date":"2026-11-07","amount_cents":4200,"direction":"saida","description":"Mercado","hash":"h2","account_id":"a1000000-0000-0000-0000-000000000012","category_id":"a1000000-0000-0000-0000-000000000021"},
  {"action":"ignorar","date":"2026-11-08","amount_cents":100,"direction":"saida","description":"Tarifa","hash":"h3"}
]'::jsonb)) ->> 'criados', '1', 'extrato cria o lançamento novo');
select is((select status::text from public.financial_transactions where id = 'a1000000-0000-0000-0000-000000000032'), 'pago', 'conciliar dá baixa na cobrança');
select is((select count(*)::int from public.financial_transactions where description in ('PIX CLIENTE', 'Tarifa')), 0, 'conciliar e ignorar não criam entrada nova');
select is((select count(*)::int from public.statement_lines where line_hash in ('h1', 'h2', 'h3')), 3, 'linhas ficam registradas para detectar duplicatas');
select throws_ok($$ select public.commit_statement('x.ofx', 'ofx', '[{"action":"conciliar","txn_id":"a1000000-0000-0000-0000-000000000032","date":"2026-11-06","amount_cents":50000,"direction":"entrada","description":"De novo","hash":"h9"}]'::jsonb) $$, 'P0001', null, 'a mesma cobrança não concilia duas vezes');
select is((select count(*)::int from public.statement_lines where line_hash = 'h9'), 0, 'falha desfaz a importação inteira');

-- Dados de recebimento separados por área.
insert into public.payment_profiles (scope, owner_user_id, pix_key, pix_key_type, holder_name) values ('pessoal', 'a1000000-0000-0000-0000-000000000001', 'eu@teste.local', 'email', 'Dona');
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.payment_profiles where scope = 'pessoal'), 0, 'Pix pessoal não aparece para outra pessoa');

-- Baixa só no que está em aberto: o histórico conta uma baixa.
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.financial_txn_events where txn_id = 'a1000000-0000-0000-0000-000000000032' and action = 'baixa'), 1, 'histórico registra uma baixa');
update public.financial_transactions set status = 'pago', paid_at = '2026-11-20', paid_amount_cents = 99 where id = 'a1000000-0000-0000-0000-000000000032' and status = 'previsto';
select is((select paid_amount_cents::int from public.financial_transactions where id = 'a1000000-0000-0000-0000-000000000032'), 50000, 'segunda baixa não muda o valor');

select * from finish();
rollback;
