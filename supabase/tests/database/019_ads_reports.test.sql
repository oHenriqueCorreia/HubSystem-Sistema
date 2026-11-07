begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- Administrador (A) e Somente leitura (L) na empresa A; a empresa B tem o próprio WhatsApp.
insert into public.organizations (id, name) values
  ('a9000000-0000-4000-8000-00000000000a', 'Relatórios A'),
  ('a9000000-0000-4000-8000-00000000000b', 'Relatórios B');

create or replace function pg_temp.mk_user(p_id uuid, p_email text, p_role uuid)
returns void language plpgsql as $$
declare
  v_inv uuid := gen_random_uuid();
begin
  insert into public.invitations (id, organization_id, email, mode, role_id, token_hash)
  values (v_inv, 'a9000000-0000-4000-8000-00000000000a', p_email, 'equipe', p_role, 'hash-' || v_inv);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, jsonb_build_object('invitation_id', v_inv), now(), now());
  update public.invitations set user_id = p_id where id = v_inv;
  perform public.finalize_invitation(v_inv, split_part(p_email, '@', 1));
end;
$$;
create or replace function pg_temp.role(p_key text) returns uuid language sql as $$
  select id from public.roles where organization_id = 'a9000000-0000-4000-8000-00000000000a' and key = p_key;
$$;
create or replace function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

select pg_temp.mk_user('a9000000-0000-4000-8000-000000000001', 'adm@rel.t', pg_temp.role('admin'));
select pg_temp.mk_user('a9000000-0000-4000-8000-000000000002', 'leitura@rel.t', pg_temp.role('leitura'));

insert into public.whatsapp_numbers (id, organization_id, provider, waha_url, waha_session, webhook_secret_enc, token_enc, status) values
  ('a9000000-0000-4000-8000-0000000000b1', 'a9000000-0000-4000-8000-00000000000a', 'waha', 'https://waha.t', 'hub_a', 'x', 'x', 'ativo'),
  ('a9000000-0000-4000-8000-0000000000b2', 'a9000000-0000-4000-8000-00000000000b', 'waha', 'https://waha.t', 'hub_b', 'x', 'x', 'ativo');
insert into public.ad_accounts (id, organization_id, provider, external_id, name, is_selected) values
  ('a9000000-0000-4000-8000-0000000000f1', 'a9000000-0000-4000-8000-00000000000a', 'meta_ads', 'act_91', 'Conta A', true);
insert into public.ad_campaigns (id, organization_id, account_id, external_id, name) values
  ('a9000000-0000-4000-8000-0000000000c1', 'a9000000-0000-4000-8000-00000000000a', 'a9000000-0000-4000-8000-0000000000f1', 'c91', 'Campanha');
insert into public.ad_insights_daily (organization_id, account_id, campaign_id, day, spend_cents, clicks, impressions, conversions) values
  ('a9000000-0000-4000-8000-00000000000a', 'a9000000-0000-4000-8000-0000000000f1', 'a9000000-0000-4000-8000-0000000000c1', current_date - 1, 4000, 10, 500, 2),
  ('a9000000-0000-4000-8000-00000000000a', 'a9000000-0000-4000-8000-0000000000f1', 'a9000000-0000-4000-8000-0000000000c1', current_date - 2, 1000, 3, 100, 0);
insert into public.ads_report_log (organization_id, kind, dedupe_key, title, body, status) values
  ('a9000000-0000-4000-8000-00000000000a', 'teste', 'teste:1', 'Mensagem de teste', 'ok', 'enviado'),
  ('a9000000-0000-4000-8000-00000000000b', 'teste', 'teste:1', 'Outra empresa', 'ok', 'enviado');

set local role authenticated;

-- Administrador configura o destino com o WhatsApp da própria empresa.
select pg_temp.as_user('a9000000-0000-4000-8000-000000000001');
select lives_ok($$ insert into public.ads_report_settings (whatsapp_number_id, group_id, group_name) values ('a9000000-0000-4000-8000-0000000000b1', '120363000000000001@g.us', 'HubSystem - Relatórios') $$,
  'administrador salva o grupo de destino');
select is((select organization_id::text from public.ads_report_settings), 'a9000000-0000-4000-8000-00000000000a', 'destino fica na empresa de quem salvou');
select throws_ok($$ update public.ads_report_settings set whatsapp_number_id = 'a9000000-0000-4000-8000-0000000000b2' $$,
  '42501', null, 'não usa o WhatsApp de outra empresa');
select throws_ok($$ update public.ads_report_settings set group_id = 'grupo-falso' $$, '23514', null, 'só aceita endereço de grupo do WhatsApp');
select is((select array_agg(title) from public.ads_report_log), array['Mensagem de teste'], 'histórico mostra só a própria empresa');
select throws_ok($$ insert into public.ads_report_log (organization_id, kind, dedupe_key, title, body, status) values ('a9000000-0000-4000-8000-00000000000a', 'teste', 'x', 't', 'b', 'enviado') $$,
  '42501', null, 'histórico é gravado só pelo servidor');
select lives_ok($$ update public.ad_accounts set alert_no_spend = true where id = 'a9000000-0000-4000-8000-0000000000f1' $$, 'administrador liga o alerta de conta parada');
select is((select spend_cents::int from public.ad_report_accounts(array['a9000000-0000-4000-8000-0000000000f1'::uuid], current_date - 1, current_date - 1)), 4000,
  'totais por conta somam só o período pedido');

select lives_ok($$ update public.ads_report_settings set send_time = '08:30', monthly_day = 28, templates = '{"semanal": "{cliente}: {investimento}"}' $$,
  'administrador salva horário, dia do mês e modelo');
select throws_ok($$ update public.ads_report_settings set send_time = '08:10' $$, '23514', null, 'horário só de 15 em 15 minutos');
select throws_ok($$ update public.ads_report_settings set monthly_day = 31 $$, '23514', null, 'dia do mensal vai de 1 a 28');
select is((select reach::int from public.ad_report_accounts(array['a9000000-0000-4000-8000-0000000000f1'::uuid], current_date - 2, current_date - 1)), 0,
  'totais por conta trazem o alcance');

-- Somente leitura vê, mas não muda.
select pg_temp.as_user('a9000000-0000-4000-8000-000000000002');
select is((select group_name from public.ads_report_settings), 'HubSystem - Relatórios', 'leitura vê o grupo configurado');
update public.ads_report_settings set weekly_enabled = false;
select is((select weekly_enabled from public.ads_report_settings), true, 'leitura não altera a configuração');
update public.ad_accounts set alert_no_spend = false where id = 'a9000000-0000-4000-8000-0000000000f1';
select is((select alert_no_spend from public.ad_accounts where id = 'a9000000-0000-4000-8000-0000000000f1'), true, 'leitura não altera alertas da conta');

select * from finish();
rollback;
