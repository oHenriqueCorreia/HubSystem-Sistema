-- Fase 1 · RPCs administrativas atômicas

create extension if not exists unaccent with schema extensions;

-- Define o papel (único) de um usuário. A troca acontece numa transação,
-- então a trava "último administrador" (trigger adiado) avalia o estado final.
create or replace function public.admin_set_user_role(p_user uuid, p_role uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.org_id();
begin
  if not private.has_perm('admin.users') then
    raise exception 'Você não tem permissão para gerenciar usuários.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and organization_id = v_org) then
    raise exception 'Usuário não encontrado.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.roles where id = p_role and organization_id = v_org) then
    raise exception 'Papel não encontrado.' using errcode = 'P0002';
  end if;

  delete from public.user_roles where user_id = p_user and role_id <> p_role;
  insert into public.user_roles (user_id, role_id) values (p_user, p_role)
  on conflict (user_id, role_id) do nothing;
end;
$$;

grant execute on function public.admin_set_user_role(uuid, uuid) to authenticated;

-- Cria um papel personalizado copiando as permissões de outro (opcional).
create or replace function public.admin_create_role(p_name text, p_description text, p_copy_from uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.org_id();
  v_id uuid;
  v_key text;
begin
  if not private.has_perm('admin.roles') then
    raise exception 'Você não tem permissão para gerenciar papéis.' using errcode = '42501';
  end if;

  v_key := left(regexp_replace(lower(extensions.unaccent(p_name)), '[^a-z]+', '_', 'g'), 30)
           || '_' || translate(substr(md5(random()::text), 1, 6), '0123456789', 'ghijklmnop');
  v_key := trim(both '_' from v_key);

  insert into public.roles (organization_id, key, name, description, is_system)
  values (v_org, v_key, trim(p_name), coalesce(trim(p_description), ''), false)
  returning id into v_id;

  if p_copy_from is not null then
    insert into public.role_permissions (role_id, permission_key, scope)
    select v_id, rp.permission_key, rp.scope
    from public.role_permissions rp
    join public.roles r on r.id = rp.role_id and r.organization_id = v_org
    where rp.role_id = p_copy_from;
  end if;

  return v_id;
end;
$$;

grant execute on function public.admin_create_role(text, text, uuid) to authenticated;
