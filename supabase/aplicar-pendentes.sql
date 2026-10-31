-- HubSystem · migrations pendentes (080000 em diante) em um único script.
-- Como usar: Supabase → SQL Editor → New query → cole TODO este arquivo → Run.
-- Tudo roda numa transação: se algo falhar, nada é aplicado. Rode uma única vez.
-- Gerado a partir de supabase/migrations/. Não edite à mão.

begin;

-- ===== supabase/migrations/20261031080000_multi_org_security.sql
-- =============================================================================
-- Fase 2 · Multiempresa e segurança
-- =============================================================================
--   * Toda organização nova nasce com os mesmos padrões (papéis, funis,
--     cadência, serviços, financeiro) — trigger em organizations.
--   * Usuário criado sem organização definida ganha a própria organização vazia
--     (antes caía na primeira organização do banco).
--   * Rate limiting persistente para endpoints sensíveis (só o servidor usa).
--   * task_tags passa a recusar etiquetas de outra organização.
-- =============================================================================

-- Padrões de uma organização. Idempotente: pode rodar de novo sem duplicar.
create or replace function private.bootstrap_organization(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_default_roles(p_org);
  perform private.seed_crm(p_org);
  perform private.seed_cadences(p_org);

  insert into public.services (organization_id, name, kind, is_recurring)
  select p_org, s.name, s.kind::public.service_kind, s.rec
  from (values
    ('Criação de site', 'site', false),
    ('Manutenção de site', 'manutencao', true),
    ('Meta Ads', 'meta_ads', true),
    ('Google Ads', 'google_ads', true),
    ('Google Meu Negócio', 'outro', false),
    ('Outros serviços', 'outro', false)
  ) as s(name, kind, rec)
  where not exists (select 1 from public.services where organization_id = p_org)
  on conflict do nothing;

  if not exists (select 1 from public.financial_accounts where organization_id = p_org and scope = 'empresa') then
    insert into public.financial_accounts (organization_id, scope, name, type)
    values (p_org, 'empresa', 'Conta principal', 'corrente');
  end if;

  if not exists (select 1 from public.financial_categories where organization_id = p_org and scope = 'empresa') then
    insert into public.financial_categories (organization_id, scope, name, kind)
    select p_org, 'empresa', c.name, c.kind::public.txn_kind
    from (values
      ('Venda de sites', 'receita'), ('Manutenção de sites', 'receita'), ('Gestão de tráfego', 'receita'), ('Outras receitas', 'receita'),
      ('Ferramentas e software', 'despesa'), ('Hospedagem e domínios', 'despesa'), ('Verba de anúncios', 'despesa'),
      ('Impostos', 'despesa'), ('Pró-labore', 'despesa'), ('Marketing', 'despesa'), ('Terceirizados', 'despesa'), ('Outras despesas', 'despesa')
    ) as c(name, kind);
  end if;

  if not exists (select 1 from public.cost_centers where organization_id = p_org) then
    insert into public.cost_centers (organization_id, name)
    select p_org, c.name from (values ('Comercial'), ('Produção'), ('Administrativo')) as c(name);
  end if;
end;
$$;

create or replace function private.organizations_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.bootstrap_organization(new.id);
  return null;
end;
$$;

create trigger organizations_bootstrap after insert on public.organizations
  for each row execute function private.organizations_after_insert();

-- Novo usuário: entra na organização indicada pelo convite; sem ela, ganha a
-- própria organização (ambiente vazio) e vira administrador dela.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_role_key text;
  v_role uuid;
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text := coalesce(nullif(trim(v_meta ->> 'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1));
begin
  select id into v_org from public.organizations
   where id = nullif(v_meta ->> 'organization_id', '')::uuid;

  if v_org is null then
    insert into public.organizations (name)
    values (left(coalesce(nullif(trim(v_meta ->> 'workspace_name'), ''), 'Empresa de ' || v_name), 120))
    returning id into v_org;
  end if;

  if not exists (select 1 from public.profiles where organization_id = v_org) then
    v_role_key := 'admin';
  else
    v_role_key := coalesce(nullif(v_meta ->> 'role_key', ''), 'colaborador');
  end if;

  insert into public.profiles (id, organization_id, full_name, email)
  values (new.id, v_org, coalesce(v_meta ->> 'full_name', ''), coalesce(new.email, ''));

  select id into v_role from public.roles where organization_id = v_org and key = v_role_key;
  if v_role is null then
    select id into v_role from public.roles where organization_id = v_org and key = 'colaborador';
  end if;

  insert into public.user_roles (user_id, role_id, created_by) values (new.id, v_role, null);
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rate limiting (janela fixa). Fica no schema private: a API não enxerga.
-- -----------------------------------------------------------------------------
create table private.rate_limits (
  bucket        text primary key,
  window_start  timestamptz not null,
  hits          int not null
);

create or replace function public.rate_limit_hit(p_bucket text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits int;
begin
  insert into private.rate_limits as r (bucket, window_start, hits)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update
    set hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  -- Limpeza ocasional de janelas antigas.
  if random() < 0.01 then
    delete from private.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_max;
end;
$$;

revoke execute on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;

-- -----------------------------------------------------------------------------
-- task_tags: a etiqueta precisa ser da mesma organização.
-- -----------------------------------------------------------------------------
drop policy task_tags_all on public.task_tags;
create policy task_tags_select on public.task_tags for select to authenticated
  using (private.can_read_task(task_id));
create policy task_tags_write on public.task_tags for all to authenticated
  using (private.can_read_task(task_id))
  with check (private.can_read_task(task_id)
              and exists (select 1 from public.tags t where t.id = tag_id and t.organization_id = (select private.org_id())));

insert into supabase_migrations.schema_migrations (version, name) values ('20261031080000', 'multi_org_security') on conflict do nothing;

-- ===== supabase/migrations/20261031090000_invitations.sql
-- =============================================================================
-- Fase 3 · Convites e novos papéis
-- =============================================================================
-- Fluxo:
--   1. O admin cria o convite (equipe = entra na organização dele; ambiente =
--      a pessoa ganha uma organização própria e vazia).
--   2. O servidor cria a conta no Auth já vinculada ao convite, com o perfil
--      INATIVO, e o Supabase envia o e-mail (template com os dados do convite).
--   3. A pessoa abre /convite/<token>, define nome e senha; o servidor valida o
--      token (hash SHA-256, uso único, prazo, e-mail) e ativa o perfil.
-- O token em claro nunca é gravado: só o hash.
-- =============================================================================

create type public.invitation_status as enum ('pendente', 'aceito', 'cancelado');
create type public.invitation_mode as enum ('equipe', 'ambiente');

create table public.invitations (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  email                 text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name             text not null default '' check (char_length(full_name) <= 120),
  mode                  public.invitation_mode not null default 'equipe',
  workspace_name        text check (char_length(workspace_name) <= 120),
  role_id               uuid references public.roles (id) on delete set null,
  permission_overrides  jsonb not null default '[]'::jsonb check (jsonb_typeof(permission_overrides) = 'array'),
  token_hash            text not null unique,
  status                public.invitation_status not null default 'pendente',
  expires_at            timestamptz not null default now() + interval '7 days',
  invited_by            uuid default auth.uid() references public.profiles (id) on delete set null,
  user_id               uuid references auth.users (id) on delete set null,
  send_count            int not null default 1,
  last_sent_at          timestamptz not null default now(),
  accepted_at           timestamptz,
  cancelled_at          timestamptz,
  cancelled_by          uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  check (mode = 'ambiente' or role_id is not null)
);

-- Um convite pendente por e-mail e organização.
create unique index invitations_pending_uq on public.invitations (organization_id, email) where status = 'pendente';
create index invitations_org_idx on public.invitations (organization_id, created_at desc);

alter table public.invitations enable row level security;

create policy invitations_select on public.invitations for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('admin.users')));
-- Escrita somente pelo servidor (chave secreta) ou pelas RPCs abaixo.
revoke insert, update, delete on public.invitations from authenticated;

create trigger audit_invitations after insert or update on public.invitations
  for each row execute function private.audit_row('token_hash', 'status,role_id,expires_at,send_count');

-- Perfil criado por convite nasce inativo até o aceite.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_role_key text;
  v_role uuid;
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text := coalesce(nullif(trim(v_meta ->> 'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1));
  v_pending boolean := (v_meta ? 'invitation_id');
begin
  select id into v_org from public.organizations
   where id = nullif(v_meta ->> 'organization_id', '')::uuid;

  if v_org is null then
    insert into public.organizations (name)
    values (left(coalesce(nullif(trim(v_meta ->> 'workspace_name'), ''), 'Empresa de ' || v_name), 120))
    returning id into v_org;
  end if;

  if not exists (select 1 from public.profiles where organization_id = v_org) then
    v_role_key := 'admin';
  else
    v_role_key := coalesce(nullif(v_meta ->> 'role_key', ''), 'colaborador');
  end if;

  insert into public.profiles (id, organization_id, full_name, email, is_active)
  values (new.id, v_org, coalesce(v_meta ->> 'full_name', ''), coalesce(new.email, ''), not v_pending);

  select id into v_role from public.roles where organization_id = v_org and key = v_role_key;
  if v_role is null then
    select id into v_role from public.roles where organization_id = v_org and key = 'colaborador';
  end if;

  insert into public.user_roles (user_id, role_id, created_by) values (new.id, v_role, null);
  return new;
end;
$$;

-- Aceite: chamado pelo servidor (service_role) depois de validar o token e
-- definir a senha. Ativa o perfil, aplica papel e exceções e marca o convite.
create or replace function public.finalize_invitation(p_invitation uuid, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
  v_ov jsonb;
begin
  select * into v_inv from public.invitations where id = p_invitation for update;
  if v_inv.id is null or v_inv.status <> 'pendente' or v_inv.expires_at < now() or v_inv.user_id is null then
    raise exception 'Convite inválido ou expirado.' using errcode = 'P0001', hint = 'invalid_invitation';
  end if;

  update public.profiles
     set is_active = true,
         full_name = coalesce(nullif(trim(p_full_name), ''), full_name)
   where id = v_inv.user_id;

  if v_inv.mode = 'equipe' and v_inv.role_id is not null then
    delete from public.user_roles where user_id = v_inv.user_id and role_id <> v_inv.role_id;
    insert into public.user_roles (user_id, role_id) values (v_inv.user_id, v_inv.role_id)
    on conflict do nothing;

    for v_ov in select * from jsonb_array_elements(v_inv.permission_overrides) loop
      insert into public.user_permission_overrides (user_id, permission_key, effect, scope)
      select v_inv.user_id, p.key, (v_ov ->> 'effect')::public.override_effect,
             coalesce((v_ov ->> 'scope')::public.permission_scope, 'all')
      from public.permissions p where p.key = v_ov ->> 'key'
      on conflict (user_id, permission_key) do update set effect = excluded.effect, scope = excluded.scope;
    end loop;
  end if;

  update public.invitations set status = 'aceito', accepted_at = now() where id = v_inv.id;
  perform private.log_event('invitation_accepted', 'invitations', v_inv.id::text, '{}'::jsonb, v_inv.organization_id);
  return v_inv.user_id;
end;
$$;

revoke execute on function public.finalize_invitation(uuid, text) from public, anon, authenticated;
grant execute on function public.finalize_invitation(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- Papéis novos: Atendente e Somente leitura (em todas as organizações)
-- -----------------------------------------------------------------------------
create or replace function private.seed_extra_roles(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role uuid;
  v_def record;
begin
  for v_def in
    select * from (values
      ('atendente', 'Atendente', 'Atende conversas e leads atribuídos, com tarefas e agenda próprias.'),
      ('leitura', 'Somente leitura', 'Consulta CRM, clientes, tarefas e agenda sem alterar nada.')
    ) as t(key, name, description)
  loop
    insert into public.roles (organization_id, key, name, description, is_system)
    values (p_org, v_def.key, v_def.name, v_def.description, true)
    on conflict (organization_id, key) do update set name = excluded.name
    returning id into v_role;

    insert into public.role_permissions (role_id, permission_key, scope)
    select v_role, p.key, x.scope::public.permission_scope
    from public.permissions p
    join (values
      ('atendente', 'crm.leads.read', 'own'), ('atendente', 'crm.leads.create', 'own'), ('atendente', 'crm.leads.update', 'own'),
      ('atendente', 'crm.pipeline.move', 'own'), ('atendente', 'crm.cadences.read', 'all'),
      ('atendente', 'tasks.read', 'own'), ('atendente', 'tasks.create', 'own'), ('atendente', 'tasks.update', 'own'),
      ('atendente', 'calendar.read', 'own'), ('atendente', 'calendar.manage', 'own'),
      ('atendente', 'finance.personal.manage', 'own'),
      ('leitura', 'crm.leads.read', 'all'), ('leitura', 'crm.cadences.read', 'all'),
      ('leitura', 'clients.read', 'all'), ('leitura', 'contracts.read', 'all'),
      ('leitura', 'tasks.read', 'all'), ('leitura', 'calendar.read', 'all'),
      ('leitura', 'dashboards.commercial', 'all')
    ) as x(role_key, key, scope) on x.role_key = v_def.key and p.key = x.key
    on conflict (role_id, permission_key) do nothing;
  end loop;
end;
$$;

create or replace function private.bootstrap_organization(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_default_roles(p_org);
  perform private.seed_extra_roles(p_org);
  perform private.seed_crm(p_org);
  perform private.seed_cadences(p_org);

  insert into public.services (organization_id, name, kind, is_recurring)
  select p_org, s.name, s.kind::public.service_kind, s.rec
  from (values
    ('Criação de site', 'site', false),
    ('Manutenção de site', 'manutencao', true),
    ('Meta Ads', 'meta_ads', true),
    ('Google Ads', 'google_ads', true),
    ('Google Meu Negócio', 'outro', false),
    ('Outros serviços', 'outro', false)
  ) as s(name, kind, rec)
  where not exists (select 1 from public.services where organization_id = p_org)
  on conflict do nothing;

  if not exists (select 1 from public.financial_accounts where organization_id = p_org and scope = 'empresa') then
    insert into public.financial_accounts (organization_id, scope, name, type)
    values (p_org, 'empresa', 'Conta principal', 'corrente');
  end if;

  if not exists (select 1 from public.financial_categories where organization_id = p_org and scope = 'empresa') then
    insert into public.financial_categories (organization_id, scope, name, kind)
    select p_org, 'empresa', c.name, c.kind::public.txn_kind
    from (values
      ('Venda de sites', 'receita'), ('Manutenção de sites', 'receita'), ('Gestão de tráfego', 'receita'), ('Outras receitas', 'receita'),
      ('Ferramentas e software', 'despesa'), ('Hospedagem e domínios', 'despesa'), ('Verba de anúncios', 'despesa'),
      ('Impostos', 'despesa'), ('Pró-labore', 'despesa'), ('Marketing', 'despesa'), ('Terceirizados', 'despesa'), ('Outras despesas', 'despesa')
    ) as c(name, kind);
  end if;

  if not exists (select 1 from public.cost_centers where organization_id = p_org) then
    insert into public.cost_centers (organization_id, name)
    select p_org, c.name from (values ('Comercial'), ('Produção'), ('Administrativo')) as c(name);
  end if;
end;
$$;

select private.seed_extra_roles(id) from public.organizations;

insert into supabase_migrations.schema_migrations (version, name) values ('20261031090000', 'invitations') on conflict do nothing;

-- ===== supabase/migrations/20261031100000_task_boards_tags.sql
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

insert into supabase_migrations.schema_migrations (version, name) values ('20261031100000', 'task_boards_tags') on conflict do nothing;

-- ===== supabase/migrations/20261031110000_calendar_guests_sync.sql
-- =============================================================================
-- Fase 5 · Agenda: convidados externos, tarefas no Google, notificações push
-- e disponibilidade
-- =============================================================================

-- Convidados por e-mail (qualquer pessoa, dentro ou fora do Hub System). O
-- Google envia o convite quando o evento é sincronizado com sendUpdates=all.
create table public.event_guests (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.calendar_events (id) on delete cascade,
  email            text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name             text not null default '' check (char_length(name) <= 120),
  optional         boolean not null default false,
  response_status  text not null default 'needsAction'
                   check (response_status in ('needsAction', 'accepted', 'declined', 'tentative')),
  created_at       timestamptz not null default now(),
  unique (event_id, email)
);

create index event_guests_event_idx on public.event_guests (event_id);

alter table public.event_guests enable row level security;
create policy event_guests_select on public.event_guests for select to authenticated
  using (private.can_read_event(event_id));
create policy event_guests_write on public.event_guests for all to authenticated
  using (private.can_manage_event(event_id))
  with check (private.can_manage_event(event_id));

-- Enviar convite/atualizações por e-mail aos convidados (padrão: sim).
alter table public.calendar_events add column send_updates boolean not null default true;

-- Tarefas com prazo também vão para o Google Agenda do responsável.
alter table public.tasks
  add column google_event_id text,
  add column google_etag text,
  add column google_synced_at timestamptz;
create unique index tasks_google_uq on public.tasks (owner_id, google_event_id) where google_event_id is not null;

-- Conexão: escopos concedidos, agendas usadas para "ocupado" e canal de push.
alter table public.google_calendar_connections
  add column scopes text[] not null default '{}',
  add column busy_calendar_ids text[] not null default '{primary}',
  add column channel_id text,
  add column channel_resource_id text,
  add column channel_token text,
  add column channel_expires_at timestamptz;
create unique index google_connections_channel_uq on public.google_calendar_connections (channel_id) where channel_id is not null;

drop function public.my_google_connection();
create or replace function public.my_google_connection()
returns table (google_email text, status text, last_synced_at timestamptz, last_error text,
               scopes text[], busy_calendar_ids text[], push_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.google_email, c.status, c.last_synced_at, c.last_error, c.scopes, c.busy_calendar_ids,
         coalesce(c.channel_expires_at > now(), false)
  from public.google_calendar_connections c
  where c.user_id = auth.uid();
$$;

revoke execute on function public.my_google_connection() from public, anon;
grant execute on function public.my_google_connection() to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261031110000', 'calendar_guests_sync') on conflict do nothing;

-- ===== supabase/migrations/20261031120000_pipeline_config.sql
-- =============================================================================
-- Fase 7 · Funil configurável: etapas (criar, reordenar, arquivar, excluir com
-- transferência) e funis novos
-- =============================================================================

alter table public.stages add column archived_at timestamptz;

create trigger audit_stages after insert or update or delete on public.stages
  for each row execute function private.audit_row();
create trigger audit_pipelines after insert or update or delete on public.pipelines
  for each row execute function private.audit_row();

-- Exclusão de etapa só pela RPC (os negócios precisam ir para algum lugar).
drop policy stages_write on public.stages;
create policy stages_insert on public.stages for insert to authenticated
  with check (organization_id = (select private.org_id()) and (select private.has_perm('crm.pipeline.configure'))
              and exists (select 1 from public.pipelines p where p.id = pipeline_id and p.organization_id = (select private.org_id())));
create policy stages_update on public.stages for update to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('crm.pipeline.configure')))
  with check (organization_id = (select private.org_id()));

-- Reordena as etapas de um funil na ordem dada (atômico).
create or replace function public.reorder_stages(p_pipeline uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_perm('crm.pipeline.configure') then
    raise exception 'Você não tem permissão para configurar o funil.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.pipelines where id = p_pipeline and organization_id = private.org_id()) then
    raise exception 'Funil não encontrado.' using errcode = 'P0002';
  end if;
  update public.stages s
     set position = x.ord - 1
    from unnest(p_ids) with ordinality as x(id, ord)
   where s.id = x.id and s.pipeline_id = p_pipeline;
end;
$$;

-- Exclui uma etapa: negócios vão para outra etapa do mesmo funil ou para a
-- lixeira. O funil sempre mantém ao menos uma etapa aberta ativa.
create or replace function public.delete_stage(p_stage uuid, p_target uuid default null, p_archive_deals boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_st public.stages;
  v_count int;
begin
  if not private.has_perm('crm.pipeline.configure') then
    raise exception 'Você não tem permissão para configurar o funil.' using errcode = '42501';
  end if;
  select * into v_st from public.stages where id = p_stage and organization_id = private.org_id();
  if v_st.id is null then
    raise exception 'Etapa não encontrada.' using errcode = 'P0002';
  end if;
  if v_st.kind = 'open' and not exists (
    select 1 from public.stages where pipeline_id = v_st.pipeline_id and kind = 'open' and id <> v_st.id and archived_at is null
  ) then
    raise exception 'O funil precisa de ao menos uma etapa aberta.' using errcode = 'P0001', hint = 'last_open_stage';
  end if;

  select count(*) into v_count from public.deals where stage_id = v_st.id and deleted_at is null;
  if v_count > 0 and p_target is null and not p_archive_deals then
    raise exception 'Esta etapa tem % negócio(s). Transfira ou arquive antes de excluir.', v_count
      using errcode = 'P0001', hint = 'stage_has_deals';
  end if;
  if p_target is not null and not exists (
    select 1 from public.stages where id = p_target and pipeline_id = v_st.pipeline_id and id <> v_st.id and archived_at is null
  ) then
    raise exception 'Etapa de destino inválida.' using errcode = 'P0001';
  end if;

  perform set_config('hub.trusted_op', 'on', true);
  if p_target is not null then
    update public.deals set stage_id = p_target, stage_changed_at = now() where stage_id = v_st.id and deleted_at is null;
  elsif p_archive_deals then
    update public.deals set deleted_at = now() where stage_id = v_st.id and deleted_at is null;
  end if;
  -- Negócios já na lixeira acompanham o destino (ou a primeira etapa aberta) para liberar a exclusão.
  update public.deals set stage_id = coalesce(p_target, (
    select id from public.stages where pipeline_id = v_st.pipeline_id and kind = 'open' and id <> v_st.id order by position limit 1))
   where stage_id = v_st.id;
  perform set_config('hub.trusted_op', 'off', true);

  -- Referências: modelos de mensagem e "etapa de origem" do histórico viram null;
  -- entradas do histórico para esta etapa saem junto (o nome fica na auditoria).
  delete from public.stages where id = v_st.id;
  perform private.log_event('delete_stage', 'stages', v_st.id::text,
    jsonb_build_object('nome', v_st.name, 'negocios', v_count, 'destino', p_target, 'arquivados', p_archive_deals and p_target is null));
  return v_count;
end;
$$;

-- Novo funil com etapas iniciais editáveis.
create or replace function public.create_pipeline(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.org_id();
  v_id uuid;
begin
  if not private.has_perm('crm.pipeline.configure') then
    raise exception 'Você não tem permissão para configurar o funil.' using errcode = '42501';
  end if;
  insert into public.pipelines (organization_id, name, position)
  values (v_org, trim(p_name), coalesce((select max(position) + 1 from public.pipelines where organization_id = v_org), 0))
  returning id into v_id;
  insert into public.stages (organization_id, pipeline_id, name, position, color, kind, sla_days) values
    (v_org, v_id, 'Novo', 0, 'slate', 'open', 7),
    (v_org, v_id, 'Em contato', 1, 'blue', 'open', 5),
    (v_org, v_id, 'Proposta enviada', 2, 'orange', 'open', 5),
    (v_org, v_id, 'Ganho', 3, 'green', 'won', null),
    (v_org, v_id, 'Perdido', 4, 'rose', 'lost', null);
  return v_id;
end;
$$;

revoke execute on function public.reorder_stages(uuid, uuid[]) from public, anon;
revoke execute on function public.delete_stage(uuid, uuid, boolean) from public, anon;
revoke execute on function public.create_pipeline(text) from public, anon;
grant execute on function public.reorder_stages(uuid, uuid[]) to authenticated;
grant execute on function public.delete_stage(uuid, uuid, boolean) to authenticated;
grant execute on function public.create_pipeline(text) to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261031120000', 'pipeline_config') on conflict do nothing;

-- ===== supabase/migrations/20261031130000_finance_recurrence_control.sql
-- =============================================================================
-- Fase 10 · Financeiro: controle das séries recorrentes (pausar, retomar,
-- encerrar) sem alterar o histórico, e rótulo opcional por série
-- =============================================================================
-- Regras:
--   * Ocorrências passadas, pagas ou conciliadas nunca são tocadas.
--   * Pausar/encerrar move para a lixeira só as ocorrências PREVISTAS a partir
--     de amanhã (restauráveis). Retomar volta a gerar a partir de hoje.
-- =============================================================================

alter table public.financial_recurrences
  add column paused_at timestamptz,
  add column ended_at timestamptz;

-- Só o financeiro da empresa entra na auditoria geral (ADR 0007).
create trigger audit_financial_recurrences after update on public.financial_recurrences
  for each row when (new.scope = 'empresa')
  execute function private.audit_row('template', 'is_active,end_date,frequency,paused_at,ended_at');

create or replace function public.set_recurrence_state(p_id uuid, p_state text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec public.financial_recurrences;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_count int := 0;
begin
  select * into v_rec from public.financial_recurrences where id = p_id and organization_id = private.org_id() for update;
  if v_rec.id is null or not private.fin_can(v_rec.scope, v_rec.owner_user_id, 'update') then
    raise exception 'Recorrência não encontrada.' using errcode = 'P0002';
  end if;
  if v_rec.ended_at is not null then
    raise exception 'Esta recorrência foi encerrada. Crie uma nova se precisar.' using errcode = 'P0001';
  end if;

  if p_state in ('pausada', 'encerrada') then
    -- Permissão já conferida acima (editar a série); o guard não precisa exigir "excluir".
    perform set_config('hub.trusted_op', 'on', true);
    update public.financial_transactions
       set deleted_at = now()
     where recurrence_id = v_rec.id and status = 'previsto' and reconciled_at is null
       and due_date > v_today and deleted_at is null;
    get diagnostics v_count = row_count;
    perform set_config('hub.trusted_op', 'off', true);
    update public.financial_recurrences
       set is_active = false,
           paused_at = case when p_state = 'pausada' then now() else paused_at end,
           ended_at = case when p_state = 'encerrada' then now() else null end,
           end_date = case when p_state = 'encerrada' then v_today else end_date end
     where id = v_rec.id;
  elsif p_state = 'ativa' then
    -- Retoma a partir de hoje: a próxima geração cria as ocorrências futuras.
    update public.financial_recurrences
       set is_active = true,
           paused_at = null,
           generated_until = greatest(coalesce((
             select max(due_date) from public.financial_transactions
              where recurrence_id = v_rec.id and deleted_at is null), v_rec.start_date - 1), v_today)
     where id = v_rec.id;
  else
    raise exception 'Situação inválida.' using errcode = 'P0001';
  end if;

  if v_rec.scope = 'empresa' then
    perform private.log_event('recurrence_' || p_state, 'financial_recurrences', v_rec.id::text,
      jsonb_build_object('ocorrencias_removidas', v_count), v_rec.organization_id);
  end if;
  return v_count;
end;
$$;

revoke execute on function public.set_recurrence_state(uuid, text) from public, anon;
grant execute on function public.set_recurrence_state(uuid, text) to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261031130000', 'finance_recurrence_control') on conflict do nothing;

-- ===== supabase/migrations/20261031140000_ads_notifications.sql
-- =============================================================================
-- Fase 11 · Anúncios (Meta Ads e Google Ads) e central de notificações
-- =============================================================================
-- * Conexões externas guardam tokens cifrados no servidor (AES-GCM) numa
--   tabela sem acesso pela API; a interface lê só o estado via RPC.
-- * Métricas ficam por dia (ad_insights_daily) para relatórios por dia,
--   semana, mês ou período sem consultar a API a cada clique.
-- * Notificações têm chave de deduplicação: o mesmo alerta não se repete.
-- =============================================================================

insert into public.permissions (key, module, label, position) values
  ('ads.read', 'Anúncios', 'Ver contas, campanhas e relatórios de anúncios', 85),
  ('ads.manage', 'Anúncios', 'Conectar contas de anúncios e configurar alertas', 86)
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key, scope)
select r.id, p.key, 'all'
from public.roles r
cross join (values ('ads.read'), ('ads.manage')) as p(key)
where r.key = 'admin'
on conflict do nothing;
insert into public.role_permissions (role_id, permission_key, scope)
select r.id, 'ads.read', 'all' from public.roles r where r.key in ('gestor', 'leitura')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Conexões (somente servidor)
-- -----------------------------------------------------------------------------
create table public.integration_connections (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  provider          text not null check (provider in ('meta_ads', 'google_ads')),
  connected_by      uuid references public.profiles (id) on delete set null,
  external_user     text not null default '',
  scopes            text[] not null default '{}',
  token_enc         text not null,
  refresh_token_enc text,
  expires_at        timestamptz,
  status            text not null default 'ativa' check (status in ('ativa', 'erro', 'expirada', 'revogada')),
  last_synced_at    timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, provider)
);
alter table public.integration_connections enable row level security;
revoke all on public.integration_connections from authenticated, anon;

create or replace function public.my_ad_connections()
returns table (provider text, external_user text, status text, last_synced_at timestamptz, last_error text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.provider, c.external_user, c.status, c.last_synced_at, c.last_error, c.expires_at
  from public.integration_connections c
  where c.organization_id = private.org_id() and private.has_perm('ads.read');
$$;
revoke execute on function public.my_ad_connections() from public, anon;
grant execute on function public.my_ad_connections() to authenticated;

-- -----------------------------------------------------------------------------
-- Contas, campanhas e métricas diárias
-- -----------------------------------------------------------------------------
create table public.ad_accounts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  provider              text not null check (provider in ('meta_ads', 'google_ads')),
  external_id           text not null,
  name                  text not null,
  currency              text not null default 'BRL',
  status                text,
  is_selected           boolean not null default false,
  -- Valores informados pela API (null = a API não fornece para esta conta).
  balance_cents         bigint,
  spend_cap_cents       bigint,
  amount_spent_cents    bigint,
  -- Alertas configurados pelo usuário.
  alert_balance_below_cents  bigint check (alert_balance_below_cents >= 0),
  alert_daily_spend_above_cents bigint check (alert_daily_spend_above_cents >= 0),
  last_synced_at        timestamptz,
  created_at            timestamptz not null default now(),
  unique (organization_id, provider, external_id)
);

create table public.ad_campaigns (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete cascade,
  account_id             uuid not null references public.ad_accounts (id) on delete cascade,
  external_id            text not null,
  name                   text not null,
  status                 text,
  objective              text,
  daily_budget_cents     bigint,
  lifetime_budget_cents  bigint,
  updated_at             timestamptz not null default now(),
  unique (account_id, external_id)
);
create index ad_campaigns_account_idx on public.ad_campaigns (account_id);

create table public.ad_insights_daily (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  account_id       uuid not null references public.ad_accounts (id) on delete cascade,
  campaign_id      uuid references public.ad_campaigns (id) on delete cascade,
  day              date not null,
  impressions      bigint not null default 0,
  reach            bigint,
  clicks           bigint not null default 0,
  spend_cents      bigint not null default 0,
  conversions      numeric(14, 2),
  unique nulls not distinct (account_id, campaign_id, day)
);
create index ad_insights_account_day_idx on public.ad_insights_daily (account_id, day);

alter table public.ad_accounts enable row level security;
alter table public.ad_campaigns enable row level security;
alter table public.ad_insights_daily enable row level security;

create policy ad_accounts_select on public.ad_accounts for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('ads.read')));
create policy ad_accounts_update on public.ad_accounts for update to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('ads.manage')))
  with check (organization_id = (select private.org_id()));
-- Escrita de dados vindos das APIs: somente o servidor.
revoke insert, delete on public.ad_accounts from authenticated;
revoke update on public.ad_accounts from authenticated;
grant update (is_selected, alert_balance_below_cents, alert_daily_spend_above_cents) on public.ad_accounts to authenticated;

create policy ad_campaigns_select on public.ad_campaigns for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('ads.read')));
create policy ad_insights_select on public.ad_insights_daily for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('ads.read')));
revoke insert, update, delete on public.ad_campaigns, public.ad_insights_daily from authenticated;

create trigger audit_ad_accounts after update on public.ad_accounts
  for each row execute function private.audit_row('', 'is_selected,alert_balance_below_cents,alert_daily_spend_above_cents');

-- -----------------------------------------------------------------------------
-- Central de notificações
-- -----------------------------------------------------------------------------
create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  kind             text not null check (char_length(kind) <= 60),
  title            text not null check (char_length(title) <= 200),
  body             text check (char_length(body) <= 1000),
  href             text check (href ~ '^/[^/]'),
  dedupe_key       text not null check (char_length(dedupe_key) <= 200),
  read_at          timestamptz,
  created_at       timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke insert, delete on public.notifications from authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Gera notificações do dia para o usuário atual (idempotente pela chave).
-- Chamado ao abrir o sistema; tarefas vencidas, prazos de hoje, reuniões
-- próximas, contas vencendo e convites pendentes.
create or replace function public.refresh_my_notifications()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_org uuid := private.org_id();
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_count int;
  v_total int := 0;
begin
  if v_org is null then
    return 0;
  end if;

  insert into public.notifications (organization_id, user_id, kind, title, href, dedupe_key)
  select v_org, v_me, 'tarefa_atrasada', 'Tarefa atrasada: ' || left(t.title, 150), '/tarefas?periodo=atrasadas', 'tarefa_atrasada:' || t.id
  from public.tasks t
  where t.owner_id = v_me and t.deleted_at is null and t.status in ('a_fazer', 'em_andamento') and t.due_at < now()
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_count = row_count; v_total := v_total + v_count;

  insert into public.notifications (organization_id, user_id, kind, title, href, dedupe_key)
  select v_org, v_me, 'prazo_hoje', 'Vence hoje: ' || left(t.title, 150), '/tarefas?periodo=hoje', 'prazo_hoje:' || t.id || ':' || v_today
  from public.tasks t
  where t.owner_id = v_me and t.deleted_at is null and t.status in ('a_fazer', 'em_andamento')
    and (t.due_at at time zone 'America/Sao_Paulo')::date = v_today and t.due_at >= now()
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_count = row_count; v_total := v_total + v_count;

  insert into public.notifications (organization_id, user_id, kind, title, body, href, dedupe_key)
  select v_org, v_me, 'reuniao', 'Reunião hoje: ' || left(e.title, 150),
         to_char(e.starts_at at time zone 'America/Sao_Paulo', 'HH24:MI'), '/agenda', 'reuniao:' || e.id
  from public.calendar_events e
  where e.owner_id = v_me and e.deleted_at is null and e.kind = 'reuniao'
    and (e.starts_at at time zone 'America/Sao_Paulo')::date = v_today and e.starts_at >= now()
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_count = row_count; v_total := v_total + v_count;

  insert into public.notifications (organization_id, user_id, kind, title, href, dedupe_key)
  select v_org, v_me, case t.kind when 'receita' then 'receber' else 'pagar' end,
         case t.kind when 'receita' then 'A receber ' else 'A pagar ' end
           || case when t.due_date < v_today then '(vencido): ' when t.due_date = v_today then 'hoje: ' else 'em breve: ' end || left(t.description, 140),
         '/financeiro/' || t.scope || '/lancamentos', 'fin:' || t.id || ':' || (t.due_date <= v_today)::text
  from public.financial_transactions t
  where t.deleted_at is null and t.status = 'previsto' and t.kind in ('receita', 'despesa')
    and t.due_date <= v_today + 2 and t.due_date >= v_today - 30
    and ((t.scope = 'pessoal' and t.owner_user_id = v_me) or (t.scope = 'empresa' and private.has_perm('finance.company.read')))
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_count = row_count; v_total := v_total + v_count;

  if private.has_perm('admin.users') then
    insert into public.notifications (organization_id, user_id, kind, title, href, dedupe_key)
    select v_org, v_me, 'convite', 'Convite pendente: ' || i.email, '/configuracoes/usuarios', 'convite:' || i.id
    from public.invitations i
    where i.organization_id = v_org and i.status = 'pendente' and i.expires_at > now() and i.created_at < now() - interval '2 days'
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics v_count = row_count; v_total := v_total + v_count;
  end if;

  -- Mantém a central enxuta: lidas há mais de 30 dias saem.
  delete from public.notifications where user_id = v_me and read_at < now() - interval '30 days';
  return v_total;
end;
$$;
revoke execute on function public.refresh_my_notifications() from public, anon;
grant execute on function public.refresh_my_notifications() to authenticated;

-- Notificação criada pelo servidor (integrações, alertas de anúncios, Google).
create or replace function public.notify_users(p_org uuid, p_perm text, p_kind text, p_title text, p_body text, p_href text, p_key text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  insert into public.notifications (organization_id, user_id, kind, title, body, href, dedupe_key)
  select p_org, p.id, p_kind, left(p_title, 200), left(p_body, 1000), p_href, p_key
  from public.profiles p
  where p.organization_id = p_org and p.is_active
    and exists (
      select 1 from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
      where ur.user_id = p.id and rp.permission_key = p_perm
    )
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.notify_users(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.notify_users(uuid, text, text, text, text, text, text) to service_role;

insert into supabase_migrations.schema_migrations (version, name) values ('20261031140000', 'ads_notifications') on conflict do nothing;

-- ===== supabase/migrations/20261031150000_whatsapp_inbox.sql
-- =============================================================================
-- Fase 8 · WhatsApp (Cloud API oficial) e central de atendimento
-- Fase 9 (base) · consentimento, interrupção e pausa de cadência na resposta
-- =============================================================================
-- * Números conectados guardam o token cifrado (somente servidor).
-- * Idempotência: mensagens únicas por wamid; envios do sistema também têm
--   client_ref único (um clique repetido não envia duas vezes).
-- * Notas internas ficam na mesma linha do tempo, com direction = 'nota'.
-- =============================================================================

insert into public.permissions (key, module, label, position) values
  ('inbox.read', 'Atendimento', 'Ver conversas do WhatsApp', 55),
  ('inbox.reply', 'Atendimento', 'Responder conversas', 56),
  ('inbox.manage', 'Atendimento', 'Conectar números, transferir e configurar o atendimento', 57)
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key, scope)
select r.id, p.key, x.scope::public.permission_scope
from public.roles r
join (values
  ('admin', 'inbox.read', 'all'), ('admin', 'inbox.reply', 'all'), ('admin', 'inbox.manage', 'all'),
  ('gestor', 'inbox.read', 'all'), ('gestor', 'inbox.reply', 'all'), ('gestor', 'inbox.manage', 'all'),
  ('atendente', 'inbox.read', 'own'), ('atendente', 'inbox.reply', 'own'),
  ('vendedor', 'inbox.read', 'own'), ('vendedor', 'inbox.reply', 'own'),
  ('leitura', 'inbox.read', 'all')
) as x(role_key, key, scope) on x.role_key = r.key
join public.permissions p on p.key = x.key
on conflict do nothing;

-- Consentimento e pedido de interrupção no lead.
alter table public.leads
  add column whatsapp_consent_at timestamptz,
  add column contact_opt_out_at timestamptz;

-- -----------------------------------------------------------------------------
-- Números conectados (somente servidor) + visão segura
-- -----------------------------------------------------------------------------
create table public.whatsapp_numbers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  phone_number_id  text not null unique check (phone_number_id ~ '^\d{5,30}$'),
  waba_id          text not null check (waba_id ~ '^\d{5,30}$'),
  display_phone    text not null default '',
  verified_name    text not null default '',
  token_enc        text not null,
  status           text not null default 'ativo' check (status in ('ativo', 'erro', 'desconectado')),
  quality          text,
  last_error       text,
  connected_by     uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.whatsapp_numbers enable row level security;
revoke all on public.whatsapp_numbers from authenticated, anon;

create or replace function public.my_whatsapp_numbers()
returns table (id uuid, display_phone text, verified_name text, status text, quality text, last_error text, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.display_phone, n.verified_name, n.status, n.quality, n.last_error, n.updated_at
  from public.whatsapp_numbers n
  where n.organization_id = private.org_id() and private.has_perm('inbox.read');
$$;
revoke execute on function public.my_whatsapp_numbers() from public, anon;
grant execute on function public.my_whatsapp_numbers() to authenticated;

-- -----------------------------------------------------------------------------
-- Conversas e mensagens
-- -----------------------------------------------------------------------------
create table public.conversations (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  number_id         uuid not null references public.whatsapp_numbers (id) on delete cascade,
  contact_e164      text not null check (contact_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  contact_name      text not null default '' check (char_length(contact_name) <= 120),
  lead_id           uuid references public.leads (id) on delete set null,
  assignee_id       uuid references public.profiles (id) on delete set null,
  status            text not null default 'aberta' check (status in ('aberta', 'encerrada')),
  waiting_reply     boolean not null default false,
  last_message_at   timestamptz,
  last_inbound_at   timestamptz,
  first_response_at timestamptz,
  unread_count      int not null default 0,
  outcome           text check (char_length(outcome) <= 500),
  created_at        timestamptz not null default now(),
  unique (number_id, contact_e164)
);
create index conversations_org_idx on public.conversations (organization_id, status, last_message_at desc);
create index conversations_lead_idx on public.conversations (lead_id);
create index conversations_assignee_idx on public.conversations (assignee_id);

create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  direction        text not null check (direction in ('entrada', 'saida', 'nota')),
  wamid            text unique,
  client_ref       uuid unique,
  type             text not null default 'text' check (type in ('text', 'image', 'document', 'audio', 'video', 'sticker', 'template', 'location', 'contacts', 'reaction', 'unsupported', 'note')),
  body             text check (char_length(body) <= 4096),
  media_id         text,
  media_mime       text,
  media_name       text,
  status           text not null default 'enviada' check (status in ('recebida', 'enviando', 'enviada', 'entregue', 'lida', 'erro')),
  error            text,
  author_id        uuid references public.profiles (id) on delete set null,
  important        boolean not null default false,
  created_at       timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

create table public.conversation_tags (
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  tag_id           uuid not null references public.tags (id) on delete cascade,
  primary key (conversation_id, tag_id)
);

create table public.whatsapp_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  waba_id          text not null,
  name             text not null,
  language         text not null,
  category         text,
  status           text not null,
  components       jsonb not null default '[]'::jsonb,
  synced_at        timestamptz not null default now(),
  unique (organization_id, waba_id, name, language)
);

-- Acesso: own = conversas atribuídas a mim (ou ainda sem responsável).
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
      and (private.can('inbox.read', c.assignee_id) or (c.assignee_id is null and private.has_perm('inbox.read')))
  );
$$;
grant execute on function private.can_read_conversation(uuid) to authenticated;

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_tags enable row level security;
alter table public.whatsapp_templates enable row level security;

create policy conversations_select on public.conversations for select to authenticated
  using (organization_id = (select private.org_id())
         and (private.can('inbox.read', assignee_id) or (assignee_id is null and (select private.has_perm('inbox.read')))));
create policy conversations_update on public.conversations for update to authenticated
  using (organization_id = (select private.org_id())
         and (private.can('inbox.reply', assignee_id) or (assignee_id is null and (select private.has_perm('inbox.reply')))
              or (select private.has_perm('inbox.manage'))))
  with check (organization_id = (select private.org_id()));
revoke insert, delete on public.conversations from authenticated;

create policy messages_select on public.messages for select to authenticated
  using (private.can_read_conversation(conversation_id));
-- Pelo navegador só entram notas internas; mensagens ao cliente passam pelo servidor.
create policy messages_insert_note on public.messages for insert to authenticated
  with check (private.can_read_conversation(conversation_id) and direction = 'nota' and type = 'note'
              and author_id = (select auth.uid()) and organization_id = (select private.org_id()));
create policy messages_update on public.messages for update to authenticated
  using (private.can_read_conversation(conversation_id));
revoke update on public.messages from authenticated;
grant update (important) on public.messages to authenticated;

create policy conversation_tags_select on public.conversation_tags for select to authenticated
  using (private.can_read_conversation(conversation_id));
create policy conversation_tags_write on public.conversation_tags for all to authenticated
  using (private.can_read_conversation(conversation_id))
  with check (private.can_read_conversation(conversation_id)
              and exists (select 1 from public.tags t where t.id = tag_id and t.organization_id = (select private.org_id())));

create policy whatsapp_templates_select on public.whatsapp_templates for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('inbox.read')));
revoke insert, update, delete on public.whatsapp_templates from authenticated;

create trigger audit_conversations after update on public.conversations
  for each row execute function private.audit_row('', 'assignee_id,status,lead_id');

-- -----------------------------------------------------------------------------
-- Mensagem recebida (chamada pelo webhook, service_role). Idempotente por wamid.
-- Associa ao lead pelo telefone (com e sem 9º dígito), registra na linha do
-- tempo, pausa cadências ativas e trata pedido de interrupção.
-- -----------------------------------------------------------------------------
create or replace function public.whatsapp_receive(
  p_number uuid, p_from text, p_variants text[], p_name text, p_wamid text, p_type text,
  p_body text, p_media_id text, p_media_mime text, p_media_name text, p_at timestamptz, p_opt_out boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_conv public.conversations;
  v_lead uuid;
  v_msg uuid;
begin
  select organization_id into v_org from public.whatsapp_numbers where id = p_number;
  if v_org is null then
    raise exception 'Número não encontrado.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.messages where wamid = p_wamid) then
    return null; -- já processada (reentrega do webhook)
  end if;

  select * into v_conv from public.conversations where number_id = p_number and contact_e164 = any (p_variants) limit 1;
  if v_conv.id is null then
    select id into v_lead from public.leads
     where organization_id = v_org and deleted_at is null
       and (phone_e164 = any (p_variants) or whatsapp_e164 = any (p_variants))
     order by created_at limit 1;
    insert into public.conversations (organization_id, number_id, contact_e164, contact_name, lead_id, assignee_id)
    values (v_org, p_number, p_from, left(coalesce(p_name, ''), 120), v_lead,
            (select owner_id from public.leads where id = v_lead))
    on conflict (number_id, contact_e164) do update set contact_name = excluded.contact_name
    returning * into v_conv;
  end if;

  insert into public.messages (organization_id, conversation_id, direction, wamid, type, body, media_id, media_mime, media_name, status, created_at)
  values (v_org, v_conv.id, 'entrada', p_wamid, p_type, left(p_body, 4096), p_media_id, p_media_mime, p_media_name, 'recebida', coalesce(p_at, now()))
  on conflict (wamid) do nothing
  returning id into v_msg;
  if v_msg is null then
    return null;
  end if;

  update public.conversations
     set last_message_at = greatest(coalesce(last_message_at, p_at), p_at),
         last_inbound_at = greatest(coalesce(last_inbound_at, p_at), p_at),
         waiting_reply = true,
         unread_count = unread_count + 1,
         status = 'aberta',
         contact_name = case when contact_name = '' then left(coalesce(p_name, ''), 120) else contact_name end
   where id = v_conv.id;

  if v_conv.lead_id is not null then
    perform set_config('hub.trusted_op', 'on', true);
    update public.leads set last_contact_at = p_at,
           contact_opt_out_at = case when p_opt_out then coalesce(contact_opt_out_at, now()) else contact_opt_out_at end
     where id = v_conv.lead_id;
    -- Regra automática: quando o lead responde, a cadência ativa é pausada.
    update public.cadence_enrollments set status = 'pausada' where lead_id = v_conv.lead_id and status = 'ativa';
    perform set_config('hub.trusted_op', 'off', true);
    insert into public.activities (organization_id, lead_id, type, content, metadata, occurred_at, created_by)
    values (v_org, v_conv.lead_id, 'whatsapp', 'Mensagem recebida: ' || left(coalesce(p_body, '[' || p_type || ']'), 300),
            jsonb_build_object('conversation_id', v_conv.id, 'origem', 'automatica', 'opt_out', p_opt_out), p_at, null);
  end if;
  return v_msg;
end;
$$;
revoke execute on function public.whatsapp_receive(uuid, text, text[], text, text, text, text, text, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_receive(uuid, text, text[], text, text, text, text, text, text, text, timestamptz, boolean) to service_role;

-- Status de envio (enviada → entregue → lida, ou erro). Nunca "volta".
create or replace function public.whatsapp_status(p_wamid text, p_status text, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.messages
     set status = p_status, error = coalesce(left(p_error, 500), error)
   where wamid = p_wamid
     and (p_status = 'erro'
          or array_position(array['enviando', 'enviada', 'entregue', 'lida'], p_status)
             > coalesce(array_position(array['enviando', 'enviada', 'entregue', 'lida'], status), 0));
$$;
revoke execute on function public.whatsapp_status(text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_status(text, text, text) to service_role;

insert into supabase_migrations.schema_migrations (version, name) values ('20261031150000', 'whatsapp_inbox') on conflict do nothing;

-- ===== supabase/migrations/20261031160000_cadence_automation.sql
-- =============================================================================
-- Fase 9 · Cadências automáticas (com consentimento, janela de horário e
-- idempotência) e ações automáticas por etapa
-- =============================================================================
-- * Uma etapa pode enviar sozinha um MODELO APROVADO do WhatsApp, adicionar
--   etiqueta ou mover o negócio de etapa. As demais seguem como tarefa manual.
-- * O processamento grava uma execução por tarefa (cadence_runs.task_id é
--   único): nenhuma falha ou repetição envia a mesma etapa duas vezes.
-- * Antes de enviar: consentimento, pedido de interrupção, janela de horário
--   (fuso de São Paulo) e limite diário por organização.
-- =============================================================================

alter table public.cadence_templates
  add column send_window jsonb not null default '{"start": "08:00", "end": "20:00", "days": [1, 2, 3, 4, 5]}'::jsonb,
  add column require_consent boolean not null default true,
  add column daily_limit int not null default 200 check (daily_limit between 1 and 5000);

alter table public.cadence_steps
  add column auto_send boolean not null default false,
  add column whatsapp_template text check (char_length(whatsapp_template) <= 200),
  add column template_language text not null default 'pt_BR' check (char_length(template_language) <= 20),
  add column add_tag_id uuid references public.tags (id) on delete set null,
  add column move_to_stage_id uuid references public.stages (id) on delete set null,
  add check (not auto_send or channel <> 'whatsapp' or whatsapp_template is not null);

-- Evita entrada duplicada do mesmo lead na mesma cadência enquanto ela estiver em curso.
create unique index cadence_enrollments_open_uq on public.cadence_enrollments (lead_id, template_id) where status in ('ativa', 'pausada');

create table public.cadence_runs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  enrollment_id    uuid references public.cadence_enrollments (id) on delete cascade,
  task_id          uuid not null unique references public.tasks (id) on delete cascade,
  status           text not null check (status in ('processando', 'enviado', 'executado', 'bloqueado', 'erro')),
  detail           text check (char_length(detail) <= 500),
  attempts         int not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index cadence_runs_org_idx on public.cadence_runs (organization_id, created_at desc);

alter table public.cadence_runs enable row level security;
create policy cadence_runs_select on public.cadence_runs for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('crm.cadences.read')));
revoke insert, update, delete on public.cadence_runs from authenticated;

-- Pausar, retomar ou remover um lead de uma cadência (tarefas futuras saem).
create or replace function public.set_enrollment_status(p_enrollment uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.cadence_enrollments;
begin
  select * into v_e from public.cadence_enrollments where id = p_enrollment and organization_id = private.org_id();
  if v_e.id is null or not private.can_read_lead(v_e.lead_id)
     or not (v_e.owner_id = auth.uid() or private.can('tasks.update', v_e.owner_id)) then
    raise exception 'Inscrição não encontrada.' using errcode = 'P0002';
  end if;
  if p_status not in ('ativa', 'pausada', 'cancelada') then
    raise exception 'Situação inválida.' using errcode = 'P0001';
  end if;
  update public.cadence_enrollments set status = p_status where id = v_e.id;
  if p_status = 'cancelada' then
    perform set_config('hub.trusted_op', 'on', true);
    update public.tasks set status = 'cancelada'
     where cadence_enrollment_id = v_e.id and status in ('a_fazer', 'em_andamento') and deleted_at is null;
    perform set_config('hub.trusted_op', 'off', true);
  end if;
  insert into public.activities (organization_id, lead_id, type, content, metadata, created_by)
  values (v_e.organization_id, v_e.lead_id, 'sistema',
          case p_status when 'ativa' then 'Cadência retomada' when 'pausada' then 'Cadência pausada' else 'Lead removido da cadência' end,
          jsonb_build_object('enrollment_id', v_e.id, 'origem', 'manual'), auth.uid());
end;
$$;
revoke execute on function public.set_enrollment_status(uuid, text) from public, anon;
grant execute on function public.set_enrollment_status(uuid, text) to authenticated;

-- Tarefas automáticas vencidas e prontas (o servidor processa com a chave secreta).
create or replace function public.due_cadence_actions(p_limit int default 200)
returns table (
  task_id uuid, organization_id uuid, enrollment_id uuid, lead_id uuid, deal_id uuid, owner_id uuid,
  channel public.contact_channel, whatsapp_template text, template_language text, add_tag_id uuid, move_to_stage_id uuid,
  send_window jsonb, require_consent boolean, daily_limit int,
  lead_name text, lead_company text, lead_phone text, consent_at timestamptz, opt_out_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.organization_id, e.id, t.lead_id, t.deal_id, t.owner_id,
         s.channel, s.whatsapp_template, s.template_language, s.add_tag_id, s.move_to_stage_id,
         c.send_window, c.require_consent, c.daily_limit,
         l.name, coalesce(l.company_name, l.name), coalesce(l.whatsapp_e164, l.phone_e164), l.whatsapp_consent_at, l.contact_opt_out_at
  from public.tasks t
  join public.cadence_steps s on s.id = t.cadence_step_id
  join public.cadence_enrollments e on e.id = t.cadence_enrollment_id and e.status = 'ativa'
  join public.cadence_templates c on c.id = e.template_id and c.is_active
  join public.leads l on l.id = t.lead_id and l.deleted_at is null
  where s.auto_send and t.deleted_at is null and t.status = 'a_fazer' and t.due_at <= now()
    and not exists (select 1 from public.cadence_runs r where r.task_id = t.id and r.status <> 'erro')
  order by t.due_at
  limit p_limit;
$$;
revoke execute on function public.due_cadence_actions(int) from public, anon, authenticated;
grant execute on function public.due_cadence_actions(int) to service_role;

insert into supabase_migrations.schema_migrations (version, name) values ('20261031160000', 'cadence_automation') on conflict do nothing;

commit;
