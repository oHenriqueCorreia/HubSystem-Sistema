-- =============================================================================
-- Fase 1 · Fundação: organização, perfis, papéis, permissões, equipes, auditoria
-- =============================================================================
-- Princípios:
--   * Toda tabela de negócio tem organization_id (pronto para multiempresa).
--   * Autorização = permissão "modulo.recurso.acao" com escopo own|team|all,
--     calculada por funções SECURITY DEFINER no schema private.
--   * RLS em todas as tabelas; nenhuma política USING (true).
--   * Ações sensíveis auditadas por trigger (audit_logs é somente inserção).
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- O papel anon não tem nada a fazer no schema public (sem páginas públicas).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke execute on functions from public;

create type public.permission_scope as enum ('own', 'team', 'all');
create type public.override_effect as enum ('grant', 'deny');

-- -----------------------------------------------------------------------------
-- Utilitários
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if to_jsonb(new) ? 'updated_by' then
    new := jsonb_populate_record(new, jsonb_build_object('updated_by', auth.uid()));
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Organização
-- -----------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 120),
  settings    jsonb not null default jsonb_build_object(
                'timezone', 'America/Sao_Paulo',
                'currency', 'BRL',
                'whatsapp_default_message', 'Olá, {nome}! Tudo bem?'
              ),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger organizations_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();

-- Organização única do MVP. Renomeável em Configurações.
insert into public.organizations (name) values ('Minha empresa');

-- -----------------------------------------------------------------------------
-- Perfis (1:1 com auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  full_name        text not null default '' check (char_length(full_name) <= 120),
  email            text not null,
  phone_e164       text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  avatar_path      text,
  job_title        text check (char_length(job_title) <= 80),
  is_active        boolean not null default true,
  preferences      jsonb not null default '{}'::jsonb,
  last_seen_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index profiles_org_idx on public.profiles (organization_id);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Catálogo de permissões, papéis e vínculos
-- -----------------------------------------------------------------------------
create table public.permissions (
  key          text primary key check (key ~ '^[a-z_]+(\.[a-z_]+)+$'),
  module       text not null,
  label        text not null,
  description  text not null default '',
  position     int  not null default 0
);

create table public.roles (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  key              text not null check (key ~ '^[a-z_]{2,40}$'),
  name             text not null check (char_length(name) between 2 and 60),
  description      text not null default '',
  is_system        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, key)
);

create trigger roles_updated_at before update on public.roles
  for each row execute function private.set_updated_at();

create table public.role_permissions (
  role_id         uuid not null references public.roles (id) on delete cascade,
  permission_key  text not null references public.permissions (key) on delete cascade,
  scope           public.permission_scope not null default 'all',
  primary key (role_id, permission_key)
);

create index role_permissions_key_idx on public.role_permissions (permission_key);

create table public.user_roles (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role_id     uuid not null references public.roles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  primary key (user_id, role_id)
);

create index user_roles_role_idx on public.user_roles (role_id);

create table public.user_permission_overrides (
  user_id         uuid not null references public.profiles (id) on delete cascade,
  permission_key  text not null references public.permissions (key) on delete cascade,
  effect          public.override_effect not null,
  scope           public.permission_scope not null default 'all',
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  primary key (user_id, permission_key)
);

create index user_permission_overrides_key_idx on public.user_permission_overrides (permission_key);

create table public.teams (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 60),
  created_at       timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.team_members (
  team_id  uuid not null references public.teams (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  primary key (team_id, user_id)
);

create index team_members_user_idx on public.team_members (user_id);

-- -----------------------------------------------------------------------------
-- Funções de autorização (avaliadas uma vez por consulta via "(select ...)")
-- -----------------------------------------------------------------------------
create or replace function private.org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organization_id
  from public.profiles p
  where p.id = auth.uid() and p.is_active;
$$;

-- Escopo efetivo: maior escopo entre os papéis, ampliado por "grant",
-- anulado por "deny". Usuário inativo não tem permissão alguma.
create or replace function private.perm_scope(p_key text)
returns public.permission_scope
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.id from public.profiles p where p.id = auth.uid() and p.is_active
  ),
  ovr as (
    select o.effect, o.scope
    from public.user_permission_overrides o
    where o.user_id = (select id from me) and o.permission_key = p_key
  ),
  candidates as (
    select rp.scope
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    where ur.user_id = (select id from me) and rp.permission_key = p_key
    union all
    select scope from ovr where effect = 'grant'
  )
  select case
    when not exists (select 1 from me) then null
    when exists (select 1 from ovr where effect = 'deny') then null
    else (select max(scope) from candidates)
  end;
$$;

create or replace function private.has_perm(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.perm_scope(p_key) is not null;
$$;

-- O usuário atual divide equipe com p_user?
create or replace function private.same_team(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user = auth.uid() or exists (
    select 1
    from public.team_members a
    join public.team_members b on b.team_id = a.team_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

-- Verificação de linha com dono: aplica own/team/all.
create or replace function private.can(p_key text, p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case private.perm_scope(p_key)
    when 'all'  then true
    when 'team' then private.same_team(p_owner)
    when 'own'  then p_owner = auth.uid()
    else false
  end;
$$;

grant execute on function private.org_id(), private.perm_scope(text), private.has_perm(text),
  private.same_team(uuid), private.can(text, uuid) to authenticated, service_role;

-- Permissões efetivas do usuário atual (para a interface decidir o que mostrar).
create or replace function public.my_permissions()
returns table (permission_key text, scope public.permission_scope)
language sql
stable
security definer
set search_path = ''
as $$
  select k.key, private.perm_scope(k.key)
  from public.permissions k
  where private.perm_scope(k.key) is not null;
$$;

grant execute on function public.my_permissions() to authenticated;

-- -----------------------------------------------------------------------------
-- Auditoria
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id               bigint generated always as identity primary key,
  organization_id  uuid references public.organizations (id) on delete cascade,
  actor_id         uuid references auth.users (id) on delete set null,
  action           text not null,
  entity_type      text not null,
  entity_id        text,
  changes          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);

-- Registro explícito (usado por RPCs de negócio, ex.: conversão de lead).
create or replace function private.log_event(
  p_action text, p_entity_type text, p_entity_id text, p_changes jsonb default '{}'::jsonb,
  p_org uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, changes)
  values (coalesce(p_org, private.org_id()), auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_changes, '{}'::jsonb));
$$;

-- Trigger genérico. Argumentos opcionais:
--   TG_ARGV[0] = colunas sensíveis separadas por vírgula (valor não é gravado,
--                apenas a indicação de que mudou), ex.: 'email,phone_e164'
--   TG_ARGV[1] = colunas cuja alteração deve ser auditada (vazio = todas)
create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_redact text[] := case when tg_nargs > 0 and tg_argv[0] <> '' then string_to_array(tg_argv[0], ',') else '{}' end;
  v_only text[] := case when tg_nargs > 1 and tg_argv[1] <> '' then string_to_array(tg_argv[1], ',') else null end;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_action text := lower(tg_op);
  v_row jsonb := coalesce(v_new, v_old);
  v_org uuid;
  v_id text;
begin
  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      continue when v_key in ('updated_at', 'updated_by', 'position', 'last_seen_at');
      continue when v_only is not null and not (v_key = any (v_only));
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        v_changes := v_changes || jsonb_build_object(
          v_key,
          case when v_key = any (v_redact)
            then jsonb_build_object('alterado', true)
            else jsonb_build_object('de', v_old -> v_key, 'para', v_new -> v_key)
          end
        );
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return new;
    end if;
    if (v_old ->> 'deleted_at') is null and (v_new ->> 'deleted_at') is not null then
      v_action := 'soft_delete';
    elsif (v_old ->> 'deleted_at') is not null and (v_new ->> 'deleted_at') is null then
      v_action := 'restore';
    end if;
  else
    -- Em inserções/exclusões guardamos um retrato sem os campos sensíveis.
    v_changes := v_row;
    foreach v_key in array v_redact loop
      v_changes := v_changes - v_key;
    end loop;
  end if;

  v_org := coalesce(
    (v_row ->> 'organization_id')::uuid,
    (select p.organization_id from public.profiles p where p.id = (v_row ->> 'user_id')::uuid),
    (select r.organization_id from public.roles r where r.id = (v_row ->> 'role_id')::uuid),
    private.org_id()
  );
  v_id := coalesce(v_row ->> 'id', v_row ->> 'user_id');

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, changes)
  values (v_org, auth.uid(), v_action, tg_table_name, v_id, v_changes);

  return coalesce(new, old);
end;
$$;

-- -----------------------------------------------------------------------------
-- Catálogo de permissões
-- -----------------------------------------------------------------------------
insert into public.permissions (key, module, label, position) values
  ('crm.leads.read',            'CRM',         'Ver leads', 10),
  ('crm.leads.create',          'CRM',         'Cadastrar leads', 11),
  ('crm.leads.update',          'CRM',         'Editar leads', 12),
  ('crm.leads.delete',          'CRM',         'Excluir leads', 13),
  ('crm.leads.import',          'CRM',         'Importar leads', 14),
  ('crm.leads.export',          'CRM',         'Exportar leads', 15),
  ('crm.leads.assign',          'CRM',         'Trocar responsável', 16),
  ('crm.pipeline.move',         'CRM',         'Mover no funil', 17),
  ('crm.pipeline.configure',    'CRM',         'Configurar funis e etapas', 18),
  ('crm.cadences.read',         'CRM',         'Ver cadências', 19),
  ('crm.cadences.manage',       'CRM',         'Gerenciar modelos de cadência', 20),
  ('clients.read',              'Clientes',    'Ver clientes', 30),
  ('clients.create',            'Clientes',    'Converter e cadastrar clientes', 31),
  ('clients.update',            'Clientes',    'Editar clientes', 32),
  ('clients.delete',            'Clientes',    'Excluir clientes', 33),
  ('contracts.read',            'Contratos',   'Ver contratos', 40),
  ('contracts.create',          'Contratos',   'Criar contratos', 41),
  ('contracts.update',          'Contratos',   'Editar contratos', 42),
  ('contracts.delete',          'Contratos',   'Excluir contratos', 43),
  ('tasks.read',                'Tarefas',     'Ver tarefas', 50),
  ('tasks.create',              'Tarefas',     'Criar tarefas', 51),
  ('tasks.update',              'Tarefas',     'Editar tarefas', 52),
  ('tasks.delete',              'Tarefas',     'Excluir tarefas', 53),
  ('calendar.read',             'Agenda',      'Ver agenda', 60),
  ('calendar.manage',           'Agenda',      'Criar e editar eventos', 61),
  ('finance.company.read',      'Financeiro',  'Ver financeiro da empresa', 70),
  ('finance.company.create',    'Financeiro',  'Lançar no financeiro da empresa', 71),
  ('finance.company.update',    'Financeiro',  'Editar lançamentos da empresa', 72),
  ('finance.company.delete',    'Financeiro',  'Excluir lançamentos da empresa', 73),
  ('finance.company.reconcile', 'Financeiro',  'Conciliar lançamentos', 74),
  ('finance.company.reports',   'Financeiro',  'Relatórios financeiros da empresa', 75),
  ('finance.personal.manage',   'Financeiro',  'Usar o financeiro pessoal', 76),
  ('finance.personal.admin_read','Financeiro', 'Consultar o financeiro pessoal de outros usuários', 77),
  ('dashboards.commercial',     'Dashboards',  'Dashboard comercial', 80),
  ('dashboards.financial',      'Dashboards',  'Dashboard financeiro', 81),
  ('admin.users',               'Administração','Gerenciar usuários', 90),
  ('admin.roles',               'Administração','Gerenciar papéis e permissões', 91),
  ('admin.settings',            'Administração','Alterar configurações gerais', 92),
  ('admin.audit',               'Administração','Ver auditoria', 93),
  ('admin.data_export',         'Administração','Exportar e excluir dados (LGPD)', 94);

-- Papéis padrão da organização. Escopo: o = own, t = team, a = all.
create or replace function private.seed_default_roles(p_org uuid)
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
      ('admin', 'Administrador', 'Acesso total ao sistema.'),
      ('gestor', 'Gestor', 'Coordena a operação comercial e as tarefas de toda a equipe.'),
      ('vendedor', 'Vendedor', 'Trabalha os próprios leads, tarefas e agenda.'),
      ('financeiro', 'Financeiro', 'Cuida das finanças da empresa.'),
      ('colaborador', 'Colaborador', 'Executa tarefas atribuídas.')
    ) as t(key, name, description)
  loop
    insert into public.roles (organization_id, key, name, description, is_system)
    values (p_org, v_def.key, v_def.name, v_def.description, true)
    on conflict (organization_id, key) do update set name = excluded.name
    returning id into v_role;

    insert into public.role_permissions (role_id, permission_key, scope)
    select v_role, p.key, x.scope::public.permission_scope
    from public.permissions p
    join (
      select * from (values
        -- admin: tudo
        ('admin', '%', 'all'),
        -- gestor
        ('gestor', 'crm.%', 'all'),
        ('gestor', 'clients.%', 'all'),
        ('gestor', 'contracts.%', 'all'),
        ('gestor', 'tasks.%', 'all'),
        ('gestor', 'calendar.%', 'all'),
        ('gestor', 'dashboards.commercial', 'all'),
        ('gestor', 'finance.personal.manage', 'own'),
        -- vendedor
        ('vendedor', 'crm.leads.read', 'own'),
        ('vendedor', 'crm.leads.create', 'own'),
        ('vendedor', 'crm.leads.update', 'own'),
        ('vendedor', 'crm.leads.import', 'own'),
        ('vendedor', 'crm.pipeline.move', 'own'),
        ('vendedor', 'crm.cadences.read', 'all'),
        ('vendedor', 'clients.read', 'own'),
        ('vendedor', 'clients.create', 'own'),
        ('vendedor', 'contracts.read', 'own'),
        ('vendedor', 'contracts.create', 'own'),
        ('vendedor', 'tasks.read', 'own'),
        ('vendedor', 'tasks.create', 'own'),
        ('vendedor', 'tasks.update', 'own'),
        ('vendedor', 'calendar.read', 'own'),
        ('vendedor', 'calendar.manage', 'own'),
        ('vendedor', 'dashboards.commercial', 'own'),
        ('vendedor', 'finance.personal.manage', 'own'),
        -- financeiro
        ('financeiro', 'finance.company.%', 'all'),
        ('financeiro', 'finance.personal.manage', 'own'),
        ('financeiro', 'clients.read', 'all'),
        ('financeiro', 'contracts.read', 'all'),
        ('financeiro', 'dashboards.financial', 'all'),
        ('financeiro', 'tasks.read', 'own'),
        ('financeiro', 'tasks.create', 'own'),
        ('financeiro', 'tasks.update', 'own'),
        ('financeiro', 'calendar.read', 'own'),
        ('financeiro', 'calendar.manage', 'own'),
        -- colaborador
        ('colaborador', 'crm.leads.read', 'own'),
        ('colaborador', 'tasks.read', 'own'),
        ('colaborador', 'tasks.create', 'own'),
        ('colaborador', 'tasks.update', 'own'),
        ('colaborador', 'calendar.read', 'own'),
        ('colaborador', 'calendar.manage', 'own'),
        ('colaborador', 'finance.personal.manage', 'own')
      ) as m(role_key, pattern, scope)
    ) x on x.role_key = v_def.key and p.key like x.pattern
    on conflict (role_id, permission_key) do nothing;
  end loop;
end;
$$;

select private.seed_default_roles(id) from public.organizations;

-- -----------------------------------------------------------------------------
-- Novo usuário (convite) → perfil + papel
-- O cadastro público fica desligado; usuários só nascem por convite do servidor,
-- que informa organization_id e role_key em raw_user_meta_data.
-- O primeiro usuário da organização vira administrador.
-- -----------------------------------------------------------------------------
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
begin
  v_org := coalesce(
    nullif(v_meta ->> 'organization_id', '')::uuid,
    (select id from public.organizations order by created_at limit 1)
  );

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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- E-mail do perfil acompanha o do Auth.
create or replace function private.sync_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function private.sync_user_email();

-- -----------------------------------------------------------------------------
-- Salvaguardas
-- -----------------------------------------------------------------------------
-- Sempre deve existir ao menos um administrador ativo.
create or replace function private.ensure_admin_remains()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if tg_table_name = 'user_roles' then
    select organization_id into v_org from public.roles where id = old.role_id;
  else
    v_org := old.organization_id;
  end if;

  if v_org is not null and not exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.key = 'admin'
    join public.profiles p on p.id = ur.user_id and p.is_active
    where r.organization_id = v_org
  ) and exists (select 1 from public.profiles where organization_id = v_org) then
    raise exception 'É necessário manter ao menos um administrador ativo.'
      using errcode = 'P0001', hint = 'last_admin';
  end if;
  return null;
end;
$$;

create constraint trigger user_roles_keep_admin
  after delete or update on public.user_roles
  deferrable initially deferred
  for each row execute function private.ensure_admin_remains();

create constraint trigger profiles_keep_admin
  after update of is_active on public.profiles
  deferrable initially deferred
  for each row execute function private.ensure_admin_remains();

-- O papel Administrador é fixo: suas permissões não podem ser alteradas,
-- e papéis do sistema não podem ser excluídos.
create or replace function private.protect_system_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'role_permissions' then
    -- auth.uid() só existe em chamadas pela API; migrations e seeds passam.
    if auth.uid() is not null
       and exists (select 1 from public.roles where id = coalesce(new.role_id, old.role_id) and key = 'admin') then
      raise exception 'As permissões do papel Administrador não podem ser alteradas.'
        using errcode = 'P0001', hint = 'admin_role_locked';
    end if;
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' and old.is_system then
    raise exception 'Papéis padrão do sistema não podem ser excluídos.'
      using errcode = 'P0001', hint = 'system_role';
  end if;
  if tg_op = 'UPDATE' and old.is_system and new.key <> old.key then
    raise exception 'O identificador de um papel padrão não pode mudar.'
      using errcode = 'P0001', hint = 'system_role';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger roles_protect before update or delete on public.roles
  for each row execute function private.protect_system_roles();

create trigger role_permissions_protect before insert or update or delete on public.role_permissions
  for each row execute function private.protect_system_roles();

-- -----------------------------------------------------------------------------
-- Auditoria das tabelas de acesso
-- -----------------------------------------------------------------------------
create trigger audit_user_roles after insert or update or delete on public.user_roles
  for each row execute function private.audit_row();
create trigger audit_user_permission_overrides after insert or update or delete on public.user_permission_overrides
  for each row execute function private.audit_row();
create trigger audit_role_permissions after insert or update or delete on public.role_permissions
  for each row execute function private.audit_row();
create trigger audit_roles after insert or update or delete on public.roles
  for each row execute function private.audit_row();
create trigger audit_profiles after update on public.profiles
  for each row execute function private.audit_row('email,phone_e164', 'is_active,full_name,email,job_title');
create trigger audit_organizations after update on public.organizations
  for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- RPCs administrativas
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_user_active(p_user uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_perm('admin.users') then
    raise exception 'Você não tem permissão para gerenciar usuários.' using errcode = '42501';
  end if;
  if p_user = auth.uid() and not p_active then
    raise exception 'Você não pode desativar a própria conta.' using errcode = 'P0001', hint = 'self_deactivate';
  end if;
  update public.profiles
     set is_active = p_active
   where id = p_user and organization_id = private.org_id();
  if not found then
    raise exception 'Usuário não encontrado.' using errcode = 'P0002';
  end if;
end;
$$;

grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Privilégios de coluna: o próprio usuário só altera dados pessoais do perfil.
-- -----------------------------------------------------------------------------
revoke update on public.profiles from authenticated;
grant update (full_name, phone_e164, avatar_path, job_title, preferences, last_seen_at)
  on public.profiles to authenticated;

revoke insert, update, delete on public.audit_logs from authenticated;
revoke insert, update, delete on public.permissions from authenticated;
revoke insert, delete on public.organizations from authenticated;
revoke update on public.organizations from authenticated;
grant update (name, settings) on public.organizations to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_permission_overrides enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.audit_logs enable row level security;

-- organizations
create policy organizations_select on public.organizations for select to authenticated
  using (id = (select private.org_id()));
create policy organizations_update on public.organizations for update to authenticated
  using (id = (select private.org_id()) and (select private.has_perm('admin.settings')))
  with check (id = (select private.org_id()));

-- profiles: colegas da organização são visíveis (necessário para atribuir responsáveis)
create policy profiles_select on public.profiles for select to authenticated
  using (organization_id = (select private.org_id()) or id = (select auth.uid()));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- permissions: catálogo legível por qualquer usuário autenticado
create policy permissions_select on public.permissions for select to authenticated
  using ((select auth.uid()) is not null);

-- roles
create policy roles_select on public.roles for select to authenticated
  using (organization_id = (select private.org_id()));
create policy roles_insert on public.roles for insert to authenticated
  with check (organization_id = (select private.org_id()) and (select private.has_perm('admin.roles')) and not is_system);
create policy roles_update on public.roles for update to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('admin.roles')))
  with check (organization_id = (select private.org_id()));
create policy roles_delete on public.roles for delete to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('admin.roles')) and not is_system);

-- role_permissions
create policy role_permissions_select on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and r.organization_id = (select private.org_id())));
create policy role_permissions_write on public.role_permissions for all to authenticated
  using ((select private.has_perm('admin.roles'))
         and exists (select 1 from public.roles r where r.id = role_id and r.organization_id = (select private.org_id())))
  with check ((select private.has_perm('admin.roles'))
         and exists (select 1 from public.roles r where r.id = role_id and r.organization_id = (select private.org_id())));

-- user_roles: o próprio usuário vê os seus; administradores de usuários veem e alteram todos
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = (select auth.uid())
         or ((select private.has_perm('admin.users'))
             and exists (select 1 from public.profiles p where p.id = user_id and p.organization_id = (select private.org_id()))));
create policy user_roles_write on public.user_roles for all to authenticated
  using ((select private.has_perm('admin.users'))
         and exists (select 1 from public.profiles p where p.id = user_id and p.organization_id = (select private.org_id())))
  with check ((select private.has_perm('admin.users'))
         and exists (select 1 from public.profiles p where p.id = user_id and p.organization_id = (select private.org_id()))
         and exists (select 1 from public.roles r where r.id = role_id and r.organization_id = (select private.org_id())));

-- user_permission_overrides
create policy overrides_select on public.user_permission_overrides for select to authenticated
  using (user_id = (select auth.uid())
         or ((select private.has_perm('admin.users'))
             and exists (select 1 from public.profiles p where p.id = user_id and p.organization_id = (select private.org_id()))));
create policy overrides_write on public.user_permission_overrides for all to authenticated
  using ((select private.has_perm('admin.roles'))
         and exists (select 1 from public.profiles p where p.id = user_id and p.organization_id = (select private.org_id())))
  with check ((select private.has_perm('admin.roles'))
         and exists (select 1 from public.profiles p where p.id = user_id and p.organization_id = (select private.org_id())));

-- teams
create policy teams_select on public.teams for select to authenticated
  using (organization_id = (select private.org_id()));
create policy teams_write on public.teams for all to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('admin.users')))
  with check (organization_id = (select private.org_id()) and (select private.has_perm('admin.users')));

create policy team_members_select on public.team_members for select to authenticated
  using (exists (select 1 from public.teams t where t.id = team_id and t.organization_id = (select private.org_id())));
create policy team_members_write on public.team_members for all to authenticated
  using ((select private.has_perm('admin.users'))
         and exists (select 1 from public.teams t where t.id = team_id and t.organization_id = (select private.org_id())))
  with check ((select private.has_perm('admin.users'))
         and exists (select 1 from public.teams t where t.id = team_id and t.organization_id = (select private.org_id())));

-- audit_logs: leitura restrita; escrita apenas por triggers/funções SECURITY DEFINER
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('admin.audit')));
