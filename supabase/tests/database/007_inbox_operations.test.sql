begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select ok(has_table_privilege('authenticated', 'public.quick_replies', 'select,insert,update,delete'), 'respostas rápidas disponíveis à API com RLS');
select ok(has_table_privilege('authenticated', 'public.campaigns', 'select,insert,update,delete'), 'campanhas disponíveis à API com RLS');
select ok(not has_table_privilege('authenticated', 'public.webhook_endpoints', 'select'), 'segredo de webhook não fica exposto');
select ok(has_table_privilege('service_role', 'public.hub_events', 'select,insert,update,delete'), 'servidor pode processar eventos');

insert into public.organizations (id, name) values
  ('d0000000-0000-0000-0000-00000000000b', 'Atendimento A'),
  ('d0000000-0000-0000-0000-00000000000c', 'Atendimento B');
insert into public.whatsapp_numbers (id, organization_id, provider, waha_url, waha_session, token_enc, webhook_secret_enc) values
  ('d0000000-0000-0000-0000-000000000011', 'd0000000-0000-0000-0000-00000000000b', 'waha', 'https://wa-a.example.com', 'sessao_a', 'teste', 'teste'),
  ('d0000000-0000-0000-0000-000000000012', 'd0000000-0000-0000-0000-00000000000c', 'waha', 'https://wa-b.example.com', 'sessao_b', 'teste', 'teste');
insert into public.leads (id, organization_id, name) values
  ('d0000000-0000-0000-0000-000000000021', 'd0000000-0000-0000-0000-00000000000b', 'Contato A'),
  ('d0000000-0000-0000-0000-000000000022', 'd0000000-0000-0000-0000-00000000000c', 'Contato B');

select throws_ok($$
  insert into public.campaigns (organization_id, name, number_id, body)
  values ('d0000000-0000-0000-0000-00000000000b', 'Número alheio', 'd0000000-0000-0000-0000-000000000012', 'Oi')
$$, '23514', null, 'campanha recusa número de outra organização');

insert into public.campaigns (id, organization_id, name, number_id, body)
values ('d0000000-0000-0000-0000-000000000031', 'd0000000-0000-0000-0000-00000000000b', 'Campanha A', 'd0000000-0000-0000-0000-000000000011', 'Oi');
select throws_ok($$
  insert into public.campaign_recipients (organization_id, campaign_id, lead_id)
  values ('d0000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-000000000031', 'd0000000-0000-0000-0000-000000000022')
$$, '23514', null, 'campanha recusa contato de outra organização');

insert into public.campaign_recipients (organization_id, campaign_id, lead_id)
values ('d0000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-000000000031', 'd0000000-0000-0000-0000-000000000021');
select is((select count(*)::int from public.campaign_recipients where campaign_id = 'd0000000-0000-0000-0000-000000000031'), 1, 'destinatário da mesma organização entra');

insert into public.automations (id, organization_id, name, trigger, actions)
values ('d0000000-0000-0000-0000-000000000041', 'd0000000-0000-0000-0000-00000000000b', 'Aviso de lead', 'lead_criado', '[{"type":"notificar","title":"Novo lead"}]');
insert into public.hub_events (organization_id, kind, lead_id)
values ('d0000000-0000-0000-0000-00000000000b', 'lead_criado', 'd0000000-0000-0000-0000-000000000021');
select public.inbox_jobs_claim(10);
select is((select count(*)::int from public.automation_runs where automation_id = 'd0000000-0000-0000-0000-000000000041'), 1, 'evento cria uma execução');
select public.inbox_jobs_claim(10);
select is((select count(*)::int from public.automation_runs where automation_id = 'd0000000-0000-0000-0000-000000000041'), 1, 'repetir o processamento não duplica');

select * from finish();
rollback;
