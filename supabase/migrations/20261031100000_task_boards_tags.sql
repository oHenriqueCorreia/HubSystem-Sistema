-- =============================================================================
-- Fase 4 · Tarefas: etiquetas, colunas do quadro, participantes, dependências
-- e histórico
-- =============================================================================
-- Colunas do quadro são da organização e cada uma pertence a um status-base
-- (a_fazer, em_andamento, concluida, cancelada). Assim "atrasada", dashboards,
-- cadências e o registro de conclusão continuam funcionando com qualquer coluna.
-- =============================================================================

insert into public.permissions (key, module, label, position) values
  ('tags.manage', 'CRM', 'Gerenciar etiquetas (criar, editar, arquivar e excluir)', 21),
  ('tasks.board.configure', 'Tarefas', 'Configurar as colunas do quadro de tarefas', 54)
on conflict (key) do nothing;

-- Admin e gestor de todas as organizações recebem as permissões novas.
insert into public.role_permissions (role_id, permission_key, scope)
select r.id, p.key, 'all'
from public.roles r
cross join (values ('tags.manage'), ('tasks.board.configure')) as p(key)
where r.key in ('admin', 'gestor')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Etiquetas (compartilhadas por tarefas, leads, conversas e cadências)
-- -----------------------------------------------------------------------------
alter table public.tags
  add column description text check (char_length(description) <= 300),
  add column archived_at timestamptz;

drop policy tags_insert on public.tags;
drop policy tags_manage on public.tags;
drop policy tags_delete on public.tags;

create policy tags_insert on public.tags for insert to authenticated
  with check (organization_id = (select private.org_id())
              and ((select private.has_perm('tags.manage')) or (select private.has_perm('crm.leads.update'))
                   or (select private.has_perm('tasks.create'))));
create policy tags_update on public.tags for update to authenticated
  using (organization_id = (select private.org_id())
         and ((select private.has_perm('tags.manage')) or (select private.has_perm('crm.pipeline.configure'))))
  with check (organization_id = (select private.org_id()));
create policy tags_delete on public.tags for delete to authenticated
  using (organization_id = (select private.org_id())
         and ((select private.has_perm('tags.manage')) or (select private.has_perm('crm.pipeline.configure'))));

create trigger audit_tags after update or delete on public.tags
  for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- Colunas do quadro
-- -----------------------------------------------------------------------------
create table public.task_columns (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  name             text not null check (char_length(trim(name)) between 1 and 40),
  color            text not null default 'slate' check (color ~ '^[a-z]{3,10}$'),
  kind             public.task_status not null,
  position         double precision not null default 0,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index task_columns_org_idx on public.task_columns (organization_id, position);

create trigger task_columns_updated_at before update on public.task_columns
  for each row execute function private.set_updated_at();
create trigger audit_task_columns after insert or update or delete on public.task_columns
  for each row execute function private.audit_row();

create or replace function private.seed_task_columns(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.task_columns where organization_id = p_org) then
    return;
  end if;
  insert into public.task_columns (organization_id, name, color, kind, position) values
    (p_org, 'A fazer', 'slate', 'a_fazer', 1024),
    (p_org, 'Em andamento', 'blue', 'em_andamento', 2048),
    (p_org, 'Concluído', 'green', 'concluida', 3072),
    (p_org, 'Cancelado', 'rose', 'cancelada', 4096);
end;
$$;

select private.seed_task_columns(id) from public.organizations;

create or replace function private.organizations_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.bootstrap_organization(new.id);
  perform private.seed_task_columns(new.id);
  return null;
end;
$$;

alter table public.tasks add column column_id uuid references public.task_columns (id) on delete set null;
create index tasks_column_idx on public.tasks (column_id) where deleted_at is null;

update public.tasks t
   set column_id = c.id
  from public.task_columns c
 where c.organization_id = t.organization_id and c.kind = t.status and t.column_id is null;

-- Coluna e status andam juntos: mover de coluna muda o status; mudar o status
-- (lista, cadência, Meu dia) leva a tarefa para a primeira coluna daquele status.
-- Roda antes de tasks_guard (ordem alfabética), que trata completed_at.
create or replace function private.tasks_column_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.task_status;
begin
  if new.column_id is not null and (tg_op = 'INSERT' or new.column_id is distinct from old.column_id) then
    select kind into v_kind from public.task_columns
     where id = new.column_id and organization_id = new.organization_id;
    if v_kind is null then
      raise exception 'Coluna do quadro não encontrada.' using errcode = 'P0002';
    end if;
    new.status := v_kind;
  elsif new.column_id is null or (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    select id into new.column_id from public.task_columns
     where organization_id = new.organization_id and kind = new.status and archived_at is null
     order by position limit 1;
  end if;
  return new;
end;
$$;

create trigger tasks_column_sync before insert or update on public.tasks
  for each row execute function private.tasks_column_sync();

alter table public.task_columns enable row level security;
create policy task_columns_select on public.task_columns for select to authenticated
  using (organization_id = (select private.org_id()));
create policy task_columns_insert on public.task_columns for insert to authenticated
  with check (organization_id = (select private.org_id()) and (select private.has_perm('tasks.board.configure')));
create policy task_columns_update on public.task_columns for update to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('tasks.board.configure')))
  with check (organization_id = (select private.org_id()));
-- Exclusão somente pela RPC abaixo (trata as tarefas da coluna).
revoke delete on public.task_columns from authenticated;

-- Exclui uma coluna com segurança: as tarefas são transferidas para outra
-- coluna ou arquivadas (lixeira, restauráveis). Sempre sobra ao menos uma
-- coluna ativa de cada status.
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
    raise exception 'Coluna não encontrada.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.task_columns
                  where organization_id = v_col.organization_id and kind = v_col.kind and id <> v_col.id and archived_at is null) then
    raise exception 'Mantenha ao menos uma coluna ativa com o status “%”.', v_col.kind
      using errcode = 'P0001', hint = 'last_column_of_kind';
  end if;

  select count(*) into v_count from public.tasks where column_id = v_col.id and deleted_at is null;
  if v_count > 0 and p_target is null and not p_archive_tasks then
    raise exception 'Esta coluna tem % tarefa(s). Transfira ou arquive as tarefas antes de excluir.', v_count
      using errcode = 'P0001', hint = 'column_has_tasks';
  end if;
  if p_target is not null and not exists (
    select 1 from public.task_columns where id = p_target and organization_id = v_col.organization_id and id <> v_col.id and archived_at is null
  ) then
    raise exception 'Coluna de destino inválida.' using errcode = 'P0001';
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

revoke execute on function public.delete_task_column(uuid, uuid, boolean) from public, anon;
grant execute on function public.delete_task_column(uuid, uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Participantes e dependências
-- -----------------------------------------------------------------------------
create table public.task_participants (
  task_id  uuid not null references public.tasks (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  primary key (task_id, user_id)
);
create index task_participants_user_idx on public.task_participants (user_id);

create table public.task_dependencies (
  task_id        uuid not null references public.tasks (id) on delete cascade,
  depends_on_id  uuid not null references public.tasks (id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (task_id, depends_on_id),
  check (task_id <> depends_on_id)
);
create index task_dependencies_dep_idx on public.task_dependencies (depends_on_id);

-- Participantes também enxergam a tarefa.
create or replace function private.can_read_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task and t.organization_id = private.org_id() and t.deleted_at is null
      and (private.can('tasks.read', t.owner_id) or t.created_by = auth.uid()
           or exists (select 1 from public.task_participants p where p.task_id = t.id and p.user_id = auth.uid()))
  );
$$;

drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is null
         and (private.can('tasks.read', owner_id) or created_by = (select auth.uid())
              or exists (select 1 from public.task_participants p where p.task_id = tasks.id and p.user_id = (select auth.uid()))));

alter table public.task_participants enable row level security;
alter table public.task_dependencies enable row level security;

create policy task_participants_select on public.task_participants for select to authenticated
  using (private.can_read_task(task_id));
create policy task_participants_write on public.task_participants for all to authenticated
  using (private.can_read_task(task_id))
  with check (private.can_read_task(task_id)
              and exists (select 1 from public.profiles p where p.id = user_id and p.organization_id = (select private.org_id())));

create policy task_dependencies_select on public.task_dependencies for select to authenticated
  using (private.can_read_task(task_id));
create policy task_dependencies_write on public.task_dependencies for all to authenticated
  using (private.can_read_task(task_id))
  with check (private.can_read_task(task_id) and private.can_read_task(depends_on_id));

-- -----------------------------------------------------------------------------
-- Histórico da tarefa (auditoria ampliada + leitura para quem vê a tarefa)
-- -----------------------------------------------------------------------------
drop trigger audit_tasks on public.tasks;
create trigger audit_tasks after insert or update or delete on public.tasks
  for each row execute function private.audit_row('description', 'title,owner_id,status,column_id,priority,due_at,deleted_at');

create or replace function public.task_history(p_task uuid)
returns table (created_at timestamptz, action text, actor_name text, changes jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select a.created_at, a.action, coalesce(nullif(p.full_name, ''), p.email, 'Sistema'), a.changes
  from public.audit_logs a
  left join public.profiles p on p.id = a.actor_id
  where private.can_read_task(p_task)
    and a.entity_type = 'tasks' and a.entity_id = p_task::text
    and a.organization_id = private.org_id()
  order by a.created_at desc
  limit 100;
$$;

revoke execute on function public.task_history(uuid) from public, anon;
grant execute on function public.task_history(uuid) to authenticated;
