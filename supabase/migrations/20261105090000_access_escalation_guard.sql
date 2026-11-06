-- =============================================================================
-- Trava contra autoelevação de acesso
-- =============================================================================
-- Antes: quem tinha "admin.users" (sem ser Administrador) podia se dar o papel
-- Administrador; quem tinha "admin.roles" podia se conceder qualquer permissão
-- por exceção individual ou ampliar o próprio papel.
-- Agora, para quem não é Administrador:
--   * não altera o próprio acesso (papel, exceções, permissões do próprio papel);
--   * não mexe no acesso nem na conta de um Administrador;
--   * não atribui o papel Administrador;
--   * só concede o que ele mesmo tem, no mesmo escopo ou menor.
-- O Administrador continua livre (a trava do último administrador segue valendo).
-- Chamadas sem usuário (migrations, convites pelo servidor) não passam por aqui.
-- =============================================================================

create or replace function private.is_org_admin(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.key = 'admin'
    join public.profiles p on p.id = ur.user_id and p.is_active and p.organization_id = r.organization_id
    where ur.user_id = p_user
  );
$$;

-- Mesma regra de private.perm_scope, para qualquer usuário (notificações, delegação).
create or replace function private.user_perm_scope(p_user uuid, p_key text)
returns public.permission_scope
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.id from public.profiles p where p.id = p_user and p.is_active
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

-- O usuário atual pode repassar esta permissão neste escopo?
create or replace function private.can_delegate(p_key text, p_scope public.permission_scope)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_admin(auth.uid())
      or coalesce(private.perm_scope(p_key) >= p_scope, false);
$$;

revoke execute on function private.is_org_admin(uuid), private.user_perm_scope(uuid, text),
  private.can_delegate(text, public.permission_scope) from public, anon;
grant execute on function private.is_org_admin(uuid), private.user_perm_scope(uuid, text),
  private.can_delegate(text, public.permission_scope) to authenticated, service_role;

create or replace function private.guard_access_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_target uuid;
  v_role uuid;
  v_missing text;
begin
  if v_actor is null or private.is_org_admin(v_actor) then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'role_permissions' then
    v_role := coalesce(new.role_id, old.role_id);
    if exists (select 1 from public.user_roles where user_id = v_actor and role_id = v_role) then
      raise exception 'Você não pode alterar as permissões do seu próprio papel.'
        using errcode = '42501', hint = 'self_access';
    end if;
    if tg_op <> 'DELETE' and not private.can_delegate(new.permission_key, new.scope) then
      raise exception 'Você só pode conceder permissões que você mesmo tem, no mesmo escopo.'
        using errcode = '42501', hint = 'delegate_beyond_own';
    end if;
    return coalesce(new, old);
  end if;

  -- user_roles e user_permission_overrides
  v_target := coalesce(new.user_id, old.user_id);
  if v_target = v_actor then
    raise exception 'Você não pode alterar o seu próprio acesso. Peça a um administrador.'
      using errcode = '42501', hint = 'self_access';
  end if;
  if private.is_org_admin(v_target) then
    raise exception 'Somente um administrador altera o acesso de outro administrador.'
      using errcode = '42501', hint = 'admin_target';
  end if;

  if tg_table_name = 'user_roles' and tg_op <> 'DELETE' then
    if exists (select 1 from public.roles where id = new.role_id and key = 'admin') then
      raise exception 'Somente um administrador atribui o papel Administrador.'
        using errcode = '42501', hint = 'admin_role';
    end if;
    select rp.permission_key into v_missing
    from public.role_permissions rp
    where rp.role_id = new.role_id and not private.can_delegate(rp.permission_key, rp.scope)
    limit 1;
    if v_missing is not null then
      raise exception 'Este papel tem permissões que você não tem (%). Peça a um administrador.', v_missing
        using errcode = '42501', hint = 'delegate_beyond_own';
    end if;
  end if;

  -- Condições separadas: o PL/pgSQL não interrompe o "and", e user_roles não tem "effect".
  if tg_table_name = 'user_permission_overrides' and tg_op <> 'DELETE' then
    if new.effect = 'grant' and not private.can_delegate(new.permission_key, new.scope) then
      raise exception 'Você só pode conceder permissões que você mesmo tem, no mesmo escopo.'
        using errcode = '42501', hint = 'delegate_beyond_own';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger user_roles_guard before insert or update or delete on public.user_roles
  for each row execute function private.guard_access_change();
create trigger user_permission_overrides_guard before insert or update or delete on public.user_permission_overrides
  for each row execute function private.guard_access_change();
create trigger role_permissions_guard before insert or update or delete on public.role_permissions
  for each row execute function private.guard_access_change();

-- Desativar/reativar: quem não é administrador não mexe na conta de um administrador.
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
  if private.is_org_admin(p_user) and not private.is_org_admin(auth.uid()) then
    raise exception 'Somente um administrador desativa outro administrador.' using errcode = '42501', hint = 'admin_target';
  end if;
  update public.profiles
     set is_active = p_active
   where id = p_user and organization_id = private.org_id();
  if not found then
    raise exception 'Usuário não encontrado.' using errcode = 'P0002';
  end if;
end;
$$;

-- Notificações respeitam as exceções individuais ("negar" tira, "conceder" inclui).
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
    and private.user_perm_scope(p.id, p_perm) is not null
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
