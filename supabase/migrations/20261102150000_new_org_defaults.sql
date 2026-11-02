-- =============================================================================
-- Empresas novas: mesmas permissões das antigas, e remoção de empresa vazia
-- =============================================================================
-- 1. As migrations de etiquetas, anúncios e atendimento deram as permissões novas
--    só aos papéis que já existiam. Empresas criadas depois nasciam sem elas:
--    Gestor, Vendedor, Atendente e Somente leitura não viam Atendimento e Anúncios.
-- 2. A proteção dos papéis padrão também barrava a exclusão em cascata da empresa,
--    então cancelar um convite de ambiente próprio deixava uma empresa vazia.
-- =============================================================================

create or replace function private.seed_module_permissions(p_org uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.role_permissions (role_id, permission_key, scope)
  select r.id, p.key, x.scope::public.permission_scope
  from public.roles r
  join (values
    ('gestor', 'tags.manage', 'all'), ('gestor', 'ads.read', 'all'),
    ('gestor', 'inbox.read', 'all'), ('gestor', 'inbox.reply', 'all'), ('gestor', 'inbox.manage', 'all'),
    ('vendedor', 'inbox.read', 'own'), ('vendedor', 'inbox.reply', 'own'),
    ('atendente', 'inbox.read', 'own'), ('atendente', 'inbox.reply', 'own'),
    ('leitura', 'inbox.read', 'all'), ('leitura', 'ads.read', 'all')
  ) as x(role_key, key, scope) on x.role_key = r.key
  join public.permissions p on p.key = x.key
  where r.organization_id = p_org
  on conflict (role_id, permission_key) do nothing;
$$;

create or replace function private.organizations_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.bootstrap_organization(new.id);
  perform private.seed_module_permissions(new.id);
  return null;
end;
$$;

select private.seed_module_permissions(id) from public.organizations;

-- Papel padrão continua protegido; só sai junto com a própria empresa (cascata).
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

  if tg_op = 'DELETE' and old.is_system
     and exists (select 1 from public.organizations where id = old.organization_id) then
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
