-- =============================================================================
-- Auditoria identifica os vínculos de acesso
-- =============================================================================
-- role_permissions (e outras tabelas sem coluna id) eram gravadas sem
-- identificador, e uma mudança de escopo não dizia qual permissão mudou. Agora
-- o registro guarda o papel/pessoa/cliente/squad e a permissão alterada: dá
-- para montar o histórico de acesso de um papel e de uma pessoa.
-- =============================================================================

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
    -- Numa alteração de permissão, registra qual permissão mudou.
    if v_row ? 'permission_key' then
      v_changes := v_changes || jsonb_build_object('permission_key', v_row -> 'permission_key');
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
  -- Tabelas de vínculo sem id próprio ficam identificadas pela pessoa, papel, cliente ou squad.
  v_id := coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'role_id', v_row ->> 'client_id', v_row ->> 'team_id');

  -- Exclusão em cascata da empresa: o registro não teria a quem pertencer.
  if tg_op = 'DELETE' and (v_org is null or not exists (select 1 from public.organizations where id = v_org)) then
    return old;
  end if;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, changes)
  values (v_org, auth.uid(), v_action, tg_table_name, v_id, v_changes);

  return coalesce(new, old);
end;
$$;
