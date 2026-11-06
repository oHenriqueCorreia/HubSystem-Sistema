begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- Administrador (A), Somente leitura (L), Vendedor (V) e um editor sem permissão de valores (E).
insert into public.organizations (id, name) values ('d1000000-0000-4000-8000-00000000000a', 'Campos A');
insert into public.roles (id, organization_id, key, name) values
  ('d1000000-0000-4000-8000-0000000000e1', 'd1000000-0000-4000-8000-00000000000a', 'editor_t', 'Editor sem valores');
insert into public.role_permissions (role_id, permission_key, scope) values
  ('d1000000-0000-4000-8000-0000000000e1', 'clients.read', 'all'), ('d1000000-0000-4000-8000-0000000000e1', 'clients.update', 'all'),
  ('d1000000-0000-4000-8000-0000000000e1', 'contracts.read', 'all'), ('d1000000-0000-4000-8000-0000000000e1', 'contracts.update', 'all');

create or replace function pg_temp.mk_user(p_id uuid, p_email text, p_role uuid)
returns void language plpgsql as $$
declare
  v_inv uuid := gen_random_uuid();
begin
  insert into public.invitations (id, organization_id, email, mode, role_id, token_hash)
  values (v_inv, 'd1000000-0000-4000-8000-00000000000a', p_email, 'equipe', p_role, 'hash-' || v_inv);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, jsonb_build_object('invitation_id', v_inv), now(), now());
  update public.invitations set user_id = p_id where id = v_inv;
  perform public.finalize_invitation(v_inv, split_part(p_email, '@', 1));
end;
$$;
create or replace function pg_temp.role(p_key text) returns uuid language sql as $$
  select id from public.roles where organization_id = 'd1000000-0000-4000-8000-00000000000a' and key = p_key;
$$;
create or replace function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

select pg_temp.mk_user('d1000000-0000-4000-8000-000000000001', 'adm@campos.t', pg_temp.role('admin'));
select pg_temp.mk_user('d1000000-0000-4000-8000-000000000002', 'leitura@campos.t', pg_temp.role('leitura'));
select pg_temp.mk_user('d1000000-0000-4000-8000-000000000003', 'vendedor@campos.t', pg_temp.role('vendedor'));
select pg_temp.mk_user('d1000000-0000-4000-8000-000000000004', 'editor@campos.t', 'd1000000-0000-4000-8000-0000000000e1');

insert into public.leads (id, organization_id, name, owner_id) values
  ('d1000000-0000-4000-8000-0000000000a1', 'd1000000-0000-4000-8000-00000000000a', 'Clínica Sorriso', 'd1000000-0000-4000-8000-000000000003');
insert into public.clients (id, organization_id, lead_id, owner_id, document, billing_email) values
  ('d1000000-0000-4000-8000-0000000000c1', 'd1000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-0000000000a1',
   'd1000000-0000-4000-8000-000000000003', '12345678000190', 'financeiro@sorriso.t');
insert into public.contracts (id, organization_id, client_id, owner_id, title, amount_cents, start_date, recurrence, status) values
  ('d1000000-0000-4000-8000-0000000000f1', 'd1000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-0000000000c1',
   'd1000000-0000-4000-8000-000000000003', 'Gestão de tráfego', 150000, current_date, 'mensal', 'ativo'),
  ('d1000000-0000-4000-8000-0000000000f2', 'd1000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-0000000000c1',
   'd1000000-0000-4000-8000-000000000003', 'Site institucional', 400000, current_date, 'unica', 'ativo');

select ok(exists (select 1 from public.role_permissions where role_id = pg_temp.role('vendedor') and permission_key = 'contracts.values'),
  'empresa nova: vendedor (cria contratos) recebe contracts.values');
select ok(not exists (select 1 from public.role_permissions where role_id = pg_temp.role('leitura') and permission_key in ('contracts.values', 'clients.billing')),
  'empresa nova: somente leitura não recebe valores nem cobrança');

set local role authenticated;

-- Somente leitura: vê o contrato, não o valor; vê o cliente, não o documento.
select pg_temp.as_user('d1000000-0000-4000-8000-000000000002');
select throws_ok($$ select amount_cents from public.contracts $$, '42501', null, 'leitura não lê o valor do contrato direto na tabela');
select throws_ok($$ select document from public.clients $$, '42501', null, 'leitura não lê o CPF/CNPJ direto na tabela');
select throws_ok($$ select default_price_cents from public.services $$, '42501', null, 'leitura não lê o preço dos serviços');
select is((select count(*)::int from public.contracts), 2, 'leitura continua vendo os contratos');
select is((select count(*)::int from public.contract_values(array['d1000000-0000-4000-8000-0000000000f1'::uuid])), 0, 'contract_values não entrega valor sem permissão');
select is((select count(*)::int from public.client_billing(array['d1000000-0000-4000-8000-0000000000c1'::uuid])), 0, 'client_billing não entrega documento sem permissão');
select is((select count(*)::int from public.service_prices()), 0, 'service_prices não entrega preço sem permissão');
select is((public.commercial_dashboard(current_date - 30, current_date) ->> 'values_hidden')::boolean, true, 'painel comercial avisa que os valores estão ocultos');
select is((public.commercial_dashboard(current_date - 30, current_date) ->> 'mrr')::bigint, 0::bigint, 'painel comercial não soma valores sem permissão');

-- Vendedor: vê o valor e o documento do próprio cliente.
select pg_temp.as_user('d1000000-0000-4000-8000-000000000003');
select is((select amount_cents from public.contract_values(array['d1000000-0000-4000-8000-0000000000f1'::uuid])), 150000::bigint, 'vendedor vê o valor do próprio contrato');
select is((select document from public.client_billing(array['d1000000-0000-4000-8000-0000000000c1'::uuid])), '12345678000190', 'vendedor vê o documento do próprio cliente');
select lives_ok($$ insert into public.contracts (client_id, title, amount_cents, start_date) values ('d1000000-0000-4000-8000-0000000000c1', 'Manutenção', 9900, current_date) $$,
  'vendedor cria contrato com valor');

-- Editor sem permissão de valores: edita o resto, não os campos sensíveis.
select pg_temp.as_user('d1000000-0000-4000-8000-000000000004');
select throws_ok($$ update public.contracts set amount_cents = 1 where id = 'd1000000-0000-4000-8000-0000000000f1' $$, '42501', null, 'editor sem contracts.values não muda o valor');
select lives_ok($$ update public.contracts set title = 'Gestão de tráfego pago' where id = 'd1000000-0000-4000-8000-0000000000f1' $$, 'editor muda o título sem tocar no valor');
select throws_ok($$ update public.clients set document = '98765432000110' where id = 'd1000000-0000-4000-8000-0000000000c1' $$, '42501', null, 'editor sem clients.billing não muda o documento');
select lives_ok($$ update public.clients set notes = 'Prefere contato pela manhã' where id = 'd1000000-0000-4000-8000-0000000000c1' $$, 'editor muda observações');

-- Administrador: valores no painel e cobranças geradas a partir do contrato.
select pg_temp.as_user('d1000000-0000-4000-8000-000000000001');
select is((public.commercial_dashboard(current_date - 30, current_date) ->> 'values_hidden')::boolean, false, 'administrador vê os valores no painel');
select is((public.commercial_dashboard(current_date - 30, current_date) ->> 'mrr')::bigint, 150000::bigint, 'painel soma o recorrente ativo');
select is(public.contract_to_receivables('d1000000-0000-4000-8000-0000000000f2'), 1, 'contrato gera a cobrança com o valor certo');
select is((select amount_cents from public.financial_transactions where contract_id = 'd1000000-0000-4000-8000-0000000000f2'), 400000::bigint, 'cobrança gerada tem o valor do contrato');

select * from finish();
rollback;
