-- =============================================================================
-- Trabalho · vários quadros, cada um com suas listas, ligados à agenda
-- =============================================================================
--   * "Lista" é a antiga coluna do quadro (task_columns): nada é copiado, as
--     tarefas continuam onde estavam, agora dentro do quadro "Geral".
--   * Toda lista pertence a um quadro (board_id obrigatório): não existe lista perdida.
--   * A agenda lê as próprias tarefas e eventos, então prazo, status e responsável
--     são um dado só, sem cópia.
--   * Eventos ganham situação: cancelar deixa de ser apagar.
-- =============================================================================

create table public.task_boards (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  name             text not null check (char_length(trim(name)) between 1 and 80),
  description      text check (char_length(description) <= 500),
  client_id        uuid references public.clients (id) on delete set null,
  is_default       boolean not null default false,
  position         double precision not null default 0,
  archived_at      timestamptz,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index task_boards_org_idx on public.task_boards (organization_id, position) where archived_at is null;
create index task_boards_client_idx on public.task_boards (client_id) where archived_at is null;
create unique index task_boards_default_uq on public.task_boards (organization_id) where is_default;
create trigger task_boards_updated_at before update on public.task_boards
  for each row execute function private.set_updated_at();
create trigger audit_task_boards after insert or update or delete on public.task_boards
  for each row execute function private.audit_row();

alter table public.task_boards enable row level security;
create policy task_boards_select on public.task_boards for select to authenticated
  using (organization_id = (select private.org_id()));
create policy task_boards_insert on public.task_boards for insert to authenticated
  with check (organization_id = (select private.org_id()) and (select private.has_perm('tasks.board.configure')));
create policy task_boards_update on public.task_boards for update to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('tasks.board.configure')))
  with check (organization_id = (select private.org_id()));
revoke delete on public.task_boards from authenticated;

-- As listas existentes passam para o quadro "Geral" de cada organização.
alter table public.task_columns add column board_id uuid references public.task_boards (id) on delete cascade;
insert into public.task_boards (organization_id, name, is_default, position, created_by)
select o.id, 'Geral', true, 1024, null from public.organizations o;
update public.task_columns c set board_id = b.id
  from public.task_boards b where b.organization_id = c.organization_id and b.is_default;
alter table public.task_columns alter column board_id set not null;
create index task_columns_board_idx on public.task_columns (board_id, position) where archived_at is null;

-- Lista e quadro sempre da mesma organização.
create or replace function private.task_columns_check_board()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.task_boards b where b.id = new.board_id and b.organization_id = new.organization_id) then
    raise exception 'Quadro não encontrado.' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
create trigger task_columns_check_board before insert or update of board_id on public.task_columns
  for each row execute function private.task_columns_check_board();

-- Quadro novo já nasce com as quatro listas-base: mudar o status de uma tarefa sempre tem para onde ir.
create or replace function private.task_boards_seed_lists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.task_columns (organization_id, board_id, name, color, kind, position) values
    (new.organization_id, new.id, 'A fazer', 'slate', 'a_fazer', 1024),
    (new.organization_id, new.id, 'Em andamento', 'blue', 'em_andamento', 2048),
    (new.organization_id, new.id, 'Concluído', 'green', 'concluida', 3072),
    (new.organization_id, new.id, 'Cancelado', 'rose', 'cancelada', 4096);
  return null;
end;
$$;
create trigger task_boards_seed_lists after insert on public.task_boards
  for each row execute function private.task_boards_seed_lists();

create or replace function private.seed_task_columns(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.task_boards where organization_id = p_org and is_default) then
    return;
  end if;
  insert into public.task_boards (organization_id, name, is_default, position, created_by) values (p_org, 'Geral', true, 1024, null);
end;
$$;

-- A migração 20261102150000 tirou a criação das colunas ao reescrever este gatilho:
-- organizações criadas depois dela ficaram sem listas. Volta aqui e corrige as que já existem.
create or replace function private.organizations_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.bootstrap_organization(new.id);
  perform private.seed_module_permissions(new.id);
  perform private.seed_task_columns(new.id);
  return null;
end;
$$;

insert into public.task_columns (organization_id, board_id, name, color, kind, position)
select b.organization_id, b.id, x.name, x.color, x.kind::public.task_status, x.position
  from public.task_boards b
  cross join (values ('A fazer', 'slate', 'a_fazer', 1024), ('Em andamento', 'blue', 'em_andamento', 2048), ('Concluído', 'green', 'concluida', 3072), ('Cancelado', 'rose', 'cancelada', 4096)) as x(name, color, kind, position)
 where b.is_default and not exists (select 1 from public.task_columns c where c.board_id = b.id);

-- Status e lista andam juntos, agora dentro do quadro da tarefa.
create or replace function private.tasks_column_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.task_status;
  v_board uuid;
  v_target uuid;
begin
  if new.column_id is not null and (tg_op = 'INSERT' or new.column_id is distinct from old.column_id) then
    select kind into v_kind from public.task_columns
     where id = new.column_id and organization_id = new.organization_id;
    if v_kind is null then
      raise exception 'Lista não encontrada.' using errcode = 'P0002';
    end if;
    new.status := v_kind;
  elsif new.column_id is null or (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    select board_id into v_board from public.task_columns where id = new.column_id;
    if v_board is null then
      select id into v_board from public.task_boards where organization_id = new.organization_id and is_default;
    end if;
    select id into v_target from public.task_columns
     where board_id = v_board and kind = new.status and archived_at is null
     order by position limit 1;
    -- Sem lista daquele status no quadro, a tarefa fica onde está em vez de trocar de quadro.
    if v_target is not null then
      new.column_id := v_target;
    end if;
  end if;
  return new;
end;
$$;

-- A regra de "ao menos uma lista de cada status" passa a valer por quadro.
create or replace function public.delete_task_column(p_column uuid, p_target uuid default null, p_archive_tasks boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_col public.task_columns;
  v_count int;
begin
  if not private.has_perm('tasks.board.configure') then
    raise exception 'Você não tem permissão para configurar o quadro.' using errcode = '42501';
  end if;
  select * into v_col from public.task_columns where id = p_column and organization_id = private.org_id();
  if v_col.id is null then
    raise exception 'Lista não encontrada.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.task_columns
                  where board_id = v_col.board_id and kind = v_col.kind and id <> v_col.id and archived_at is null) then
    raise exception 'Mantenha neste quadro ao menos uma lista ativa com o status “%”.', v_col.kind
      using errcode = 'P0001', hint = 'last_column_of_kind';
  end if;

  select count(*) into v_count from public.tasks where column_id = v_col.id and deleted_at is null;
  if v_count > 0 and p_target is null and not p_archive_tasks then
    raise exception 'Esta lista tem % tarefa(s). Transfira ou arquive as tarefas antes de excluir.', v_count
      using errcode = 'P0001', hint = 'column_has_tasks';
  end if;
  if p_target is not null and not exists (
    select 1 from public.task_columns where id = p_target and organization_id = v_col.organization_id and id <> v_col.id and archived_at is null
  ) then
    raise exception 'Lista de destino inválida.' using errcode = 'P0001';
  end if;

  perform set_config('hub.trusted_op', 'on', true);
  if p_target is not null then
    update public.tasks set column_id = p_target where column_id = v_col.id and deleted_at is null;
  elsif p_archive_tasks then
    update public.tasks set deleted_at = now() where column_id = v_col.id and deleted_at is null;
  end if;
  perform set_config('hub.trusted_op', 'off', true);

  delete from public.task_columns where id = v_col.id;
  perform private.log_event('delete_task_column', 'task_columns', v_col.id::text,
    jsonb_build_object('nome', v_col.name, 'tarefas', v_count, 'destino', p_target, 'arquivadas', p_archive_tasks and p_target is null));
  return v_count;
end;
$$;

-- Arquiva um quadro: as tarefas abertas precisam ir antes para outro quadro.
create or replace function public.archive_task_board(p_board uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board public.task_boards;
  v_open int;
begin
  if not private.has_perm('tasks.board.configure') then
    raise exception 'Você não tem permissão para configurar o quadro.' using errcode = '42501';
  end if;
  select * into v_board from public.task_boards where id = p_board and organization_id = private.org_id();
  if v_board.id is null then
    raise exception 'Quadro não encontrado.' using errcode = 'P0002';
  end if;
  if v_board.is_default then
    raise exception 'O quadro principal não pode ser arquivado.' using errcode = 'P0001';
  end if;
  select count(*) into v_open from public.tasks t join public.task_columns c on c.id = t.column_id
   where c.board_id = p_board and t.deleted_at is null and t.status in ('a_fazer', 'em_andamento');
  if v_open > 0 then
    raise exception 'Este quadro tem % tarefa(s) em aberto. Mova ou conclua antes de arquivar.', v_open using errcode = 'P0001';
  end if;
  update public.task_boards set archived_at = now() where id = p_board;
end;
$$;
revoke execute on function public.archive_task_board(uuid) from public, anon;
grant execute on function public.archive_task_board(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Situação do compromisso
-- -----------------------------------------------------------------------------
alter table public.calendar_events
  add column status text not null default 'agendado' check (status in ('agendado', 'confirmado', 'concluido', 'cancelado'));
create index calendar_events_client_idx on public.calendar_events (client_id) where deleted_at is null;
create index tasks_client_idx_board on public.tasks (client_id, due_at) where deleted_at is null;
