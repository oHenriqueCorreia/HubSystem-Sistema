begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into public.organizations (id, name) values
  ('e0000000-0000-0000-0000-00000000000a', 'Quadros A'),
  ('e0000000-0000-0000-0000-00000000000b', 'Quadros B');

select is((select count(*)::int from public.task_boards where organization_id = 'e0000000-0000-0000-0000-00000000000a' and is_default), 1, 'organização nova nasce com o quadro principal');
select is((select count(*)::int from public.task_columns c join public.task_boards b on b.id = c.board_id where b.organization_id = 'e0000000-0000-0000-0000-00000000000a'), 4, 'quadro principal nasce com as listas-base');
select is((select count(*)::int from public.task_columns where board_id is null), 0, 'nenhuma lista fica sem quadro');

insert into public.task_boards (id, organization_id, name) values
  ('e0000000-0000-0000-0000-000000000011', 'e0000000-0000-0000-0000-00000000000a', 'Cliente Alfa');
select is((select count(*)::int from public.task_columns where board_id = 'e0000000-0000-0000-0000-000000000011'), 4, 'quadro novo nasce com as listas-base');

insert into public.task_columns (id, organization_id, board_id, name, kind, position) values
  ('e0000000-0000-0000-0000-000000000021', 'e0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000011', 'Em revisão', 'em_andamento', 1500);
select is((select board_id from public.task_columns where id = 'e0000000-0000-0000-0000-000000000021'), 'e0000000-0000-0000-0000-000000000011'::uuid, 'lista criada aparece no quadro escolhido');

select throws_ok($$
  insert into public.task_columns (organization_id, board_id, name, kind)
  values ('e0000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-000000000011', 'Invasora', 'a_fazer')
$$, 'P0002', null, 'lista não entra em quadro de outra organização');

insert into public.tasks (id, organization_id, title, column_id, due_at, has_time) values
  ('e0000000-0000-0000-0000-000000000031', 'e0000000-0000-0000-0000-00000000000a', 'Tarefa do quadro', 'e0000000-0000-0000-0000-000000000021', '2026-12-01 13:00+00', true);
select is((select status::text from public.tasks where id = 'e0000000-0000-0000-0000-000000000031'), 'em_andamento', 'tarefa assume o status da lista');

-- Concluir pela agenda ou pela lista: continua no mesmo quadro, na lista de concluídos.
update public.tasks set status = 'concluida' where id = 'e0000000-0000-0000-0000-000000000031';
select is((select c.board_id from public.tasks t join public.task_columns c on c.id = t.column_id where t.id = 'e0000000-0000-0000-0000-000000000031'), 'e0000000-0000-0000-0000-000000000011'::uuid, 'mudar o status mantém o quadro');
select is((select c.kind::text from public.tasks t join public.task_columns c on c.id = t.column_id where t.id = 'e0000000-0000-0000-0000-000000000031'), 'concluida', 'mudar o status leva à lista daquele status');

-- Mover de lista preserva prazo: a agenda lê a mesma linha.
update public.tasks set column_id = 'e0000000-0000-0000-0000-000000000021' where id = 'e0000000-0000-0000-0000-000000000031';
select is((select due_at from public.tasks where id = 'e0000000-0000-0000-0000-000000000031'), '2026-12-01 13:00+00'::timestamptz, 'mover de lista preserva o prazo');

insert into public.tasks (id, organization_id, title) values
  ('e0000000-0000-0000-0000-000000000032', 'e0000000-0000-0000-0000-00000000000a', 'Sem lista');
select is((select b.is_default from public.tasks t join public.task_columns c on c.id = t.column_id join public.task_boards b on b.id = c.board_id where t.id = 'e0000000-0000-0000-0000-000000000032'), true, 'tarefa sem lista vai para o quadro principal');

insert into public.calendar_events (id, organization_id, title, starts_at, ends_at) values
  ('e0000000-0000-0000-0000-000000000041', 'e0000000-0000-0000-0000-00000000000a', 'Reunião', '2026-12-01 13:00+00', '2026-12-01 14:00+00');
select is((select status from public.calendar_events where id = 'e0000000-0000-0000-0000-000000000041'), 'agendado', 'compromisso começa agendado');

select * from finish();
rollback;
