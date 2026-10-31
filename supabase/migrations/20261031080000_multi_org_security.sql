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
