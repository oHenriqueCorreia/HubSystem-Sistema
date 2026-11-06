begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- Administrador (A), gestor de tráfego com escopo "próprios" (T) e Somente leitura (L).
insert into public.organizations (id, name) values
  ('a7000000-0000-4000-8000-00000000000a', 'Anúncios A'),
  ('a7000000-0000-4000-8000-00000000000b', 'Anúncios B');
insert into public.roles (id, organization_id, key, name) values
  ('a7000000-0000-4000-8000-0000000000e1', 'a7000000-0000-4000-8000-00000000000a', 'trafego_t', 'Gestor de tráfego');
insert into public.role_permissions (role_id, permission_key, scope) values
  ('a7000000-0000-4000-8000-0000000000e1', 'ads.read', 'own'), ('a7000000-0000-4000-8000-0000000000e1', 'ads.manage', 'own');

create or replace function pg_temp.mk_user(p_id uuid, p_email text, p_role uuid)
returns void language plpgsql as $$
declare
  v_inv uuid := gen_random_uuid();
begin
  insert into public.invitations (id, organization_id, email, mode, role_id, token_hash)
  values (v_inv, 'a7000000-0000-4000-8000-00000000000a', p_email, 'equipe', p_role, 'hash-' || v_inv);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, jsonb_build_object('invitation_id', v_inv), now(), now());
  update public.invitations set user_id = p_id where id = v_inv;
  perform public.finalize_invitation(v_inv, split_part(p_email, '@', 1));
end;
$$;
create or replace function pg_temp.role(p_key text) returns uuid language sql as $$
  select id from public.roles where organization_id = 'a7000000-0000-4000-8000-00000000000a' and key = p_key;
$$;
create or replace function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

select pg_temp.mk_user('a7000000-0000-4000-8000-000000000001', 'adm@ads.t', pg_temp.role('admin'));
select pg_temp.mk_user('a7000000-0000-4000-8000-000000000002', 'trafego@ads.t', 'a7000000-0000-4000-8000-0000000000e1');
select pg_temp.mk_user('a7000000-0000-4000-8000-000000000003', 'leitura@ads.t', pg_temp.role('leitura'));

insert into public.leads (id, organization_id, name) values
  ('a7000000-0000-4000-8000-0000000000a1', 'a7000000-0000-4000-8000-00000000000a', 'Pizzaria X'),
  ('a7000000-0000-4000-8000-0000000000a2', 'a7000000-0000-4000-8000-00000000000a', 'Academia Y'),
  ('a7000000-0000-4000-8000-0000000000a3', 'a7000000-0000-4000-8000-00000000000b', 'Outra empresa');
insert into public.clients (id, organization_id, lead_id) values
  ('a7000000-0000-4000-8000-0000000000c1', 'a7000000-0000-4000-8000-00000000000a', 'a7000000-0000-4000-8000-0000000000a1'),
  ('a7000000-0000-4000-8000-0000000000c2', 'a7000000-0000-4000-8000-00000000000a', 'a7000000-0000-4000-8000-0000000000a2'),
  ('a7000000-0000-4000-8000-0000000000c3', 'a7000000-0000-4000-8000-00000000000b', 'a7000000-0000-4000-8000-0000000000a3');
insert into public.client_members (client_id, user_id, organization_id) values
  ('a7000000-0000-4000-8000-0000000000c1', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-00000000000a');
insert into public.ad_clients (id, organization_id, name, client_id) values
  ('a7000000-0000-4000-8000-0000000000d1', 'a7000000-0000-4000-8000-00000000000a', 'Pizzaria X', 'a7000000-0000-4000-8000-0000000000c1'),
  ('a7000000-0000-4000-8000-0000000000d2', 'a7000000-0000-4000-8000-00000000000a', 'Academia Y', 'a7000000-0000-4000-8000-0000000000c2'),
  ('a7000000-0000-4000-8000-0000000000d3', 'a7000000-0000-4000-8000-00000000000a', 'Sem vínculo', null);
insert into public.ad_accounts (id, organization_id, provider, external_id, name, ad_client_id) values
  ('a7000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-00000000000a', 'meta_ads', 'act_1', 'Conta Pizzaria', 'a7000000-0000-4000-8000-0000000000d1'),
  ('a7000000-0000-4000-8000-0000000000f2', 'a7000000-0000-4000-8000-00000000000a', 'meta_ads', 'act_2', 'Conta Academia', 'a7000000-0000-4000-8000-0000000000d2'),
  ('a7000000-0000-4000-8000-0000000000f3', 'a7000000-0000-4000-8000-00000000000a', 'google_ads', '123', 'Conta solta', null);
insert into public.ad_campaigns (organization_id, account_id, external_id, name) values
  ('a7000000-0000-4000-8000-00000000000a', 'a7000000-0000-4000-8000-0000000000f1', 'c1', 'Rodízio de sexta'),
  ('a7000000-0000-4000-8000-00000000000a', 'a7000000-0000-4000-8000-0000000000f2', 'c2', 'Matrícula grátis');
insert into public.ad_insights_daily (organization_id, account_id, day, spend_cents) values
  ('a7000000-0000-4000-8000-00000000000a', 'a7000000-0000-4000-8000-0000000000f1', current_date, 5000),
  ('a7000000-0000-4000-8000-00000000000a', 'a7000000-0000-4000-8000-0000000000f2', current_date, 9000);
insert into public.utm_links (organization_id, ad_client_id, name, base_url, utm_source, utm_medium, utm_campaign) values
  ('a7000000-0000-4000-8000-00000000000a', 'a7000000-0000-4000-8000-0000000000d1', 'Link pizzaria', 'https://pizzaria.t', 'meta', 'cpc', 'sexta'),
  ('a7000000-0000-4000-8000-00000000000a', 'a7000000-0000-4000-8000-0000000000d2', 'Link academia', 'https://academia.t', 'meta', 'cpc', 'matricula');

set local role authenticated;

select pg_temp.as_user('a7000000-0000-4000-8000-000000000002');
select is((select array_agg(name) from public.ad_clients), array['Pizzaria X'], 'tráfego vê só o cliente de anúncio associado');
select is((select array_agg(name) from public.ad_accounts), array['Conta Pizzaria'], 'tráfego vê só a conta do cliente associado');
select is((select array_agg(name) from public.ad_campaigns), array['Rodízio de sexta'], 'tráfego vê só as campanhas do cliente associado');
select is((select sum(spend_cents)::int from public.ad_insights_daily), 5000, 'tráfego soma só o investimento do cliente associado');
select is((select array_agg(name) from public.utm_links), array['Link pizzaria'], 'tráfego vê só os UTMs do cliente associado');
select is((select count(*)::int from public.ad_report_crm(array['a7000000-0000-4000-8000-0000000000f2'::uuid], current_date - 30, current_date)), 0,
  'relatório de CRM ignora conta de outro cliente pedida pelo id');
update public.ad_accounts set alert_balance_below_cents = 1 where id = 'a7000000-0000-4000-8000-0000000000f2';
select is((select count(*)::int from public.ad_accounts where alert_balance_below_cents = 1), 0, 'tráfego não altera conta de outro cliente');
select lives_ok($$ update public.ad_accounts set alert_balance_below_cents = 2000 where id = 'a7000000-0000-4000-8000-0000000000f1' $$, 'tráfego configura alerta da conta associada');
select throws_ok($$ insert into public.ad_clients (name, client_id) values ('Academia Y 2', 'a7000000-0000-4000-8000-0000000000c2') $$,
  '42501', null, 'tráfego não cria cliente de anúncio para cliente que não atende');
select throws_ok($$ update public.ad_accounts set ad_client_id = 'a7000000-0000-4000-8000-0000000000d2' where id = 'a7000000-0000-4000-8000-0000000000f1' $$,
  '42501', null, 'tráfego não move a conta para um cliente que não atende');

-- Escopo "todos" continua vendo tudo.
select pg_temp.as_user('a7000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.ad_accounts), 3, 'somente leitura (todos) vê todas as contas');
select is((select sum(spend_cents)::int from public.ad_insights_daily), 14000, 'somente leitura soma todo o investimento');
select pg_temp.as_user('a7000000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.ad_clients), 3, 'administrador vê todos os clientes de anúncio');
select lives_ok($$ update public.ad_clients set client_id = null where id = 'a7000000-0000-4000-8000-0000000000d2' $$, 'administrador desfaz o vínculo');
select throws_ok($$ update public.ad_clients set client_id = 'a7000000-0000-4000-8000-0000000000c3' where id = 'a7000000-0000-4000-8000-0000000000d3' $$,
  '42501', null, 'não liga cliente de anúncio a cliente de outra empresa');

select * from finish();
rollback;
