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
