begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

select ok(not has_table_privilege('authenticated', 'public.social_accounts', 'select'), 'tokens das contas não ficam legíveis');
select ok(not has_table_privilege('authenticated', 'public.content_review_links', 'select'), 'links do cliente não ficam legíveis');

insert into public.organizations (id, name) values ('f0000000-0000-0000-0000-00000000000a', 'Conteúdo A');
insert into public.tasks (id, organization_id, title, status) values ('f0000000-0000-0000-0000-000000000011', 'f0000000-0000-0000-0000-00000000000a', 'Post de novembro', 'a_fazer');
insert into public.content_items (id, organization_id, task_id, caption) values ('f0000000-0000-0000-0000-000000000021', 'f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000011', 'Legenda v1');
insert into public.social_accounts (id, organization_id, platform, external_id, page_id, token_enc, selected) values
  ('f0000000-0000-0000-0000-000000000031', 'f0000000-0000-0000-0000-00000000000a', 'facebook', '123', '123', 'x', true);
insert into public.content_review_links (organization_id, content_id, version, token_hash, expires_at)
  values ('f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000021', 1, 'hash-1', now() + interval '1 day');

select throws_ok($$ update public.content_items set status = 'aprovado' where id = 'f0000000-0000-0000-0000-000000000021' $$, '42501', null, 'não dá para pular a aprovação');

-- Coloca em aprovação e o cliente pede ajustes.
select set_config('hub.trusted_op', 'on', true);
update public.content_items set status = 'aguardando_aprovacao' where id = 'f0000000-0000-0000-0000-000000000021';
select set_config('hub.trusted_op', 'off', true);
select is(public.content_decide('hash-x', 'aprovado', '', 'Ana'), 'link_invalido', 'link inexistente é recusado');
select is(public.content_decide('hash-1', 'ajustes', '  ', 'Ana'), 'comentario_obrigatorio', 'pedir ajuste exige comentário');
select is(public.content_decide('hash-1', 'ajustes', 'Troque a foto', 'Ana'), 'ok', 'cliente pede ajustes');
select is((select status from public.content_items where id = 'f0000000-0000-0000-0000-000000000021'), 'ajustes_solicitados', 'tarefa volta para a equipe');
select is((select status::text from public.tasks where id = 'f0000000-0000-0000-0000-000000000011'), 'em_andamento', 'tarefa reabre em andamento');
select is(public.content_decide('hash-1', 'aprovado', '', 'Ana'), 'link_invalido', 'o mesmo link não decide duas vezes');

-- Nova versão, novo link, aprovação.
update public.content_items set caption = 'Legenda v2' where id = 'f0000000-0000-0000-0000-000000000021';
select is((select version from public.content_items where id = 'f0000000-0000-0000-0000-000000000021'), 2, 'alterar a legenda cria nova versão');
insert into public.content_review_links (organization_id, content_id, version, token_hash, expires_at)
  values ('f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000021', 2, 'hash-2', now() + interval '1 day');
select set_config('hub.trusted_op', 'on', true);
update public.content_items set status = 'aguardando_aprovacao' where id = 'f0000000-0000-0000-0000-000000000021';
select set_config('hub.trusted_op', 'off', true);
select is(public.content_decide('hash-2', 'aprovado', '', 'Ana'), 'ok', 'cliente aprova');
select is((select approved_version from public.content_items where id = 'f0000000-0000-0000-0000-000000000021'), 2, 'decisão guarda a versão aprovada');
select is((select count(*)::int from public.content_reviews where content_id = 'f0000000-0000-0000-0000-000000000021'), 2, 'histórico guarda as duas decisões');

-- Agendado, depois alterado: cai a aprovação e o agendamento.
insert into public.content_schedules (id, organization_id, content_id, account_id, version, scheduled_at) values
  ('f0000000-0000-0000-0000-000000000041', 'f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000021', 'f0000000-0000-0000-0000-000000000031', 2, now() - interval '1 minute');
update public.content_items set caption = 'Legenda v3' where id = 'f0000000-0000-0000-0000-000000000021';
select is((select status from public.content_schedules where id = 'f0000000-0000-0000-0000-000000000041'), 'cancelado', 'alterar conteúdo aprovado cancela o agendamento');
select is((select status from public.content_items where id = 'f0000000-0000-0000-0000-000000000021'), 'em_producao', 'conteúdo alterado volta para produção');

-- Agendamento de versão antiga nunca é publicado.
insert into public.content_schedules (id, organization_id, content_id, account_id, version, scheduled_at) values
  ('f0000000-0000-0000-0000-000000000042', 'f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000021', 'f0000000-0000-0000-0000-000000000031', 2, now() - interval '1 minute');
select is((select count(*)::int from public.content_claim_due(10) where id = 'f0000000-0000-0000-0000-000000000042'), 0, 'publicador recusa versão não aprovada');

-- Publicado: conclui a tarefa e trava a edição.
select set_config('hub.trusted_op', 'on', true);
update public.content_items set approved_version = version where id = 'f0000000-0000-0000-0000-000000000021';
select set_config('hub.trusted_op', 'off', true);
update public.content_schedules set status = 'cancelado' where id = 'f0000000-0000-0000-0000-000000000042';
insert into public.content_schedules (id, organization_id, content_id, account_id, version, scheduled_at) values
  ('f0000000-0000-0000-0000-000000000043', 'f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000021', 'f0000000-0000-0000-0000-000000000031', 3, now() - interval '1 minute');
select public.content_finish('f0000000-0000-0000-0000-000000000043', 'publicado', '999', 'https://facebook.com/999', null);
select throws_ok($$ update public.content_items set caption = 'Depois' where id = 'f0000000-0000-0000-0000-000000000021' $$, 'P0001', null, 'conteúdo publicado não pode ser alterado');

select * from finish();
rollback;
