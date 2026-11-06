-- =============================================================================
-- Escopo por cliente associado e squads
-- =============================================================================
-- * client_members: quem trabalha em cada cliente (com a função, ex.: "Designer").
-- * Squads = equipes (public.teams), agora com líder, descrição e clientes
--   (team_clients). Quem está no squad trabalha nos clientes do squad.
-- * A associação SOMA ao escopo da permissão: quem tem "tasks.read" (mesmo só
--   "próprios") passa a ver também as tarefas dos clientes em que trabalha.
--   Sem a permissão do módulo, a associação não libera nada.
--   O que a associação libera:
--     clientes e o lead do cliente  → clients.read
--     contratos do cliente          → contracts.read (já seguiam o cliente)
--     tarefas (ver / editar)        → tasks.read / tasks.update
--     agenda (ver)                  → calendar.read
--     conversas (ver / responder)   → inbox.read / inbox.reply
--   Financeiro, anúncios e conteúdo não mudam aqui.
-- * Só quem tem "admin.users" associa pessoas; quem não é administrador não
--   associa a si mesmo nem liga clientes ao próprio squad (sem autoelevação).
-- * Sem nenhuma associação cadastrada, o acesso fica exatamente como antes.
-- =============================================================================

alter table public.teams
  add column leader_id uuid references public.profiles (id) on delete set null,
  add column description text not null default '' check (char_length(description) <= 300);

create table public.client_members (
  client_id        uuid not null references public.clients (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  role_label       text not null default '' check (char_length(role_label) <= 60),
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  primary key (client_id, user_id)
);
create index client_members_user_idx on public.client_members (user_id, client_id);

create table public.team_clients (
  team_id          uuid not null references public.teams (id) on delete cascade,
  client_id        uuid not null references public.clients (id) on delete cascade,
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  primary key (team_id, client_id)
);
create index team_clients_client_idx on public.team_clients (client_id);

-- -----------------------------------------------------------------------------
-- Funções de escopo
-- -----------------------------------------------------------------------------
create or replace function private.is_client_member(p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_client is not null and (
    exists (select 1 from public.client_members m where m.client_id = p_client and m.user_id = auth.uid())
    or exists (
      select 1 from public.team_clients tc
      join public.team_members tm on tm.team_id = tc.team_id
      where tc.client_id = p_client and tm.user_id = auth.uid()
    )
  );
$$;

-- O lead pertence a um cliente em que o usuário trabalha?
create or replace function private.is_client_lead_member(p_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clients c
    where c.lead_id = p_lead and c.deleted_at is null and private.is_client_member(c.id)
  );
$$;

revoke execute on function private.is_client_member(uuid), private.is_client_lead_member(uuid) from public, anon;
grant execute on function private.is_client_member(uuid), private.is_client_lead_member(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Integridade e trava contra autoelevação
-- -----------------------------------------------------------------------------
create or replace function private.client_scope_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
begin
  if tg_op <> 'DELETE' then
    if tg_table_name = 'client_members' then
      select organization_id into v_org from public.clients where id = new.client_id;
      if v_org is distinct from new.organization_id
         or not exists (select 1 from public.profiles where id = new.user_id and organization_id = v_org) then
        raise exception 'Cliente ou pessoa de outra empresa.' using errcode = '42501';
      end if;
    elsif tg_table_name = 'team_clients' then
      select organization_id into v_org from public.clients where id = new.client_id;
      if v_org is distinct from new.organization_id
         or not exists (select 1 from public.teams where id = new.team_id and organization_id = v_org) then
        raise exception 'Cliente ou squad de outra empresa.' using errcode = '42501';
      end if;
    end if;
  end if;

  if v_actor is null or private.is_org_admin(v_actor) then
    return coalesce(new, old);
  end if;

  -- Condições aninhadas: o PL/pgSQL não interrompe o "and", e cada tabela tem colunas diferentes.
  if tg_table_name in ('client_members', 'team_members') then
    if coalesce(new.user_id, old.user_id) = v_actor then
      raise exception 'Você não pode alterar o seu próprio acesso. Peça a um administrador.'
        using errcode = '42501', hint = 'self_access';
    end if;
  elsif tg_table_name = 'team_clients' then
    if exists (select 1 from public.team_members where team_id = coalesce(new.team_id, old.team_id) and user_id = v_actor) then
      raise exception 'Você não pode ligar clientes ao seu próprio squad. Peça a um administrador.'
        using errcode = '42501', hint = 'self_access';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger client_members_guard before insert or update or delete on public.client_members
  for each row execute function private.client_scope_guard();
create trigger team_clients_guard before insert or update or delete on public.team_clients
  for each row execute function private.client_scope_guard();
create trigger team_members_guard before insert or update or delete on public.team_members
  for each row execute function private.client_scope_guard();

create trigger audit_client_members after insert or update or delete on public.client_members
  for each row execute function private.audit_row();
create trigger audit_team_clients after insert or update or delete on public.team_clients
  for each row execute function private.audit_row();
create trigger audit_team_members after insert or update or delete on public.team_members
  for each row execute function private.audit_row();
create trigger audit_teams after insert or update or delete on public.teams
  for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- RLS das tabelas novas
-- -----------------------------------------------------------------------------
alter table public.client_members enable row level security;
alter table public.team_clients enable row level security;

create policy client_members_select on public.client_members for select to authenticated
  using (organization_id = (select private.org_id())
         and (user_id = (select auth.uid()) or (select private.has_perm('admin.users')) or private.can_read_client(client_id)));
create policy client_members_write on public.client_members for all to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('admin.users')))
  with check (organization_id = (select private.org_id()) and (select private.has_perm('admin.users')));

create policy team_clients_select on public.team_clients for select to authenticated
  using (organization_id = (select private.org_id()));
create policy team_clients_write on public.team_clients for all to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('admin.users')))
  with check (organization_id = (select private.org_id()) and (select private.has_perm('admin.users')));

-- -----------------------------------------------------------------------------
-- Leads: o lead de um cliente associado (com clients.read)
-- -----------------------------------------------------------------------------
create or replace function private.can_read_lead(p_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead
      and l.organization_id = private.org_id()
      and l.deleted_at is null
      and (private.can('crm.leads.read', l.owner_id)
           -- quem é responsável por um negócio do lead também enxerga o lead
           or exists (select 1 from public.deals d where d.lead_id = l.id and d.deleted_at is null
                        and private.can('crm.leads.read', d.owner_id))
           or (private.has_perm('clients.read') and private.is_client_lead_member(l.id)))
  );
$$;

drop policy leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is null
         and (private.can('crm.leads.read', owner_id)
              or exists (select 1 from public.deals d where d.lead_id = leads.id and d.deleted_at is null
                           and private.can('crm.leads.read', d.owner_id))
              or ((select private.has_perm('clients.read')) and private.is_client_lead_member(id))));

-- -----------------------------------------------------------------------------
-- Clientes (contratos seguem can_read_client)
-- -----------------------------------------------------------------------------
create or replace function private.can_read_client(p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clients c
    where c.id = p_client and c.organization_id = private.org_id() and c.deleted_at is null
      and (private.can('clients.read', c.owner_id) or private.can_read_lead(c.lead_id)
           or (private.has_perm('clients.read') and private.is_client_member(c.id)))
  );
$$;

drop policy clients_select on public.clients;
create policy clients_select on public.clients for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is null
         and (private.can('clients.read', owner_id) or private.can_read_lead(lead_id)
              or ((select private.has_perm('clients.read')) and private.is_client_member(id))));

-- -----------------------------------------------------------------------------
-- Tarefas
-- -----------------------------------------------------------------------------
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
           or exists (select 1 from public.task_participants p where p.task_id = t.id and p.user_id = auth.uid())
           or (private.has_perm('tasks.read') and private.is_client_member(t.client_id)))
  );
$$;

drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is null
         and (private.can('tasks.read', owner_id) or created_by = (select auth.uid())
              or exists (select 1 from public.task_participants p where p.task_id = tasks.id and p.user_id = (select auth.uid()))
              or ((select private.has_perm('tasks.read')) and private.is_client_member(client_id))));

drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (organization_id = (select private.org_id())
         and (private.can('tasks.update', owner_id) or created_by = (select auth.uid()) or private.can('tasks.delete', owner_id)
              or ((select private.has_perm('tasks.update')) and private.is_client_member(client_id))))
  with check (organization_id = (select private.org_id()));

create or replace function public.can_manage_task_deliveries(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
     where t.id = p_task and t.deleted_at is null and t.organization_id = private.org_id()
       and (private.can('tasks.update', t.owner_id) or t.created_by = auth.uid()
            or (private.has_perm('tasks.update') and private.is_client_member(t.client_id)))
  );
$$;

-- -----------------------------------------------------------------------------
-- Agenda (somente leitura pela associação)
-- -----------------------------------------------------------------------------
create or replace function private.can_read_event(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.calendar_events e
    where e.id = p_event and e.organization_id = private.org_id() and e.deleted_at is null
      and (private.can('calendar.read', e.owner_id)
           or exists (select 1 from public.event_attendees a where a.event_id = e.id and a.user_id = auth.uid())
           or (private.has_perm('calendar.read') and private.is_client_member(e.client_id)))
  );
$$;

drop policy events_select on public.calendar_events;
create policy events_select on public.calendar_events for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is null
         and (private.can('calendar.read', owner_id)
              or exists (select 1 from public.event_attendees a where a.event_id = calendar_events.id and a.user_id = (select auth.uid()))
              or ((select private.has_perm('calendar.read')) and private.is_client_member(client_id))));

-- -----------------------------------------------------------------------------
-- Conversas
-- -----------------------------------------------------------------------------
create or replace function private.can_read_conversation(p_conv uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conv and c.organization_id = private.org_id()
      and (private.can('inbox.read', c.assignee_id) or (c.assignee_id is null and private.has_perm('inbox.read'))
           or (private.has_perm('inbox.read') and private.is_client_member(c.client_id)))
  );
$$;

drop policy conversations_select on public.conversations;
create policy conversations_select on public.conversations for select to authenticated
  using (organization_id = (select private.org_id())
         and (private.can('inbox.read', assignee_id) or (assignee_id is null and (select private.has_perm('inbox.read')))
              or ((select private.has_perm('inbox.read')) and private.is_client_member(client_id))));

drop policy conversations_update on public.conversations;
create policy conversations_update on public.conversations for update to authenticated
  using (organization_id = (select private.org_id())
         and (private.can('inbox.reply', assignee_id) or (assignee_id is null and (select private.has_perm('inbox.reply')))
              or (select private.has_perm('inbox.manage'))
              or ((select private.has_perm('inbox.reply')) and private.is_client_member(client_id))))
  with check (organization_id = (select private.org_id()));
