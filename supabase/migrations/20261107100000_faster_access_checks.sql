-- =============================================================================
-- Checagens de acesso mais rápidas, com as mesmas regras
-- =============================================================================
-- As regras de acesso (RLS) chamam funções como private.can() e
-- private.fin_can() uma vez por linha lida. Essas funções eram escritas em SQL
-- puro, e cada chamada replanejava a consulta: ~0,65 ms por linha. Com algumas
-- centenas de lançamentos, só o painel financeiro gastava ~110 ms nisso, e o
-- custo cresce junto com os dados.
--
-- Em PL/pgSQL o plano fica guardado na sessão: a mesma checagem cai para
-- ~0,06 ms. Nenhuma regra muda: cada função devolve exatamente a mesma
-- expressão de antes (geradas a partir das definições em produção e comparadas
-- usuário a usuário antes de aplicar).
--
-- my_permissions(), lida a cada página aberta, passa a calcular todas as
-- permissões numa consulta só em vez de chamar perm_scope() 104 vezes.
-- =============================================================================

-- Escopo efetivo de uma permissão para o usuário atual.
-- Inativo ou sem sessão: nada. Negação individual vence. Senão, o maior escopo
-- entre os papéis e as concessões individuais.
create or replace function private.perm_scope(p_key text)
returns public.permission_scope
language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_me uuid;
  v_scope public.permission_scope;
begin
  select p.id into v_me from public.profiles p where p.id = auth.uid() and p.is_active;
  if v_me is null then
    return null;
  end if;
  if exists (select 1 from public.user_permission_overrides o
             where o.user_id = v_me and o.permission_key = p_key and o.effect = 'deny') then
    return null;
  end if;
  select max(c.scope) into v_scope from (
    select rp.scope
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    where ur.user_id = v_me and rp.permission_key = p_key
    union all
    select o.scope from public.user_permission_overrides o
    where o.user_id = v_me and o.permission_key = p_key and o.effect = 'grant'
  ) c;
  return v_scope;
end;
$function$;

-- Mesma regra de perm_scope(), para todas as permissões de uma vez.
create or replace function public.my_permissions()
returns table(permission_key text, scope public.permission_scope)
language sql stable security definer set search_path to ''
as $function$
  with me as (
    select p.id from public.profiles p where p.id = auth.uid() and p.is_active
  ),
  ovr as (
    select o.permission_key, o.effect, o.scope
    from public.user_permission_overrides o
    where o.user_id = (select id from me)
  ),
  candidates as (
    select rp.permission_key, rp.scope
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    where ur.user_id = (select id from me)
    union all
    select o.permission_key, o.scope from ovr o where o.effect = 'grant'
  )
  select k.key, max(c.scope)
  from public.permissions k
  join candidates c on c.permission_key = k.key
  where exists (select 1 from me)
    and not exists (select 1 from ovr o where o.permission_key = k.key and o.effect = 'deny')
  group by k.key
  having max(c.scope) is not null;
$function$;

-- Funções usadas pelas regras de acesso: mesma expressão, agora em PL/pgSQL.

create or replace function private.has_perm(p_key text)
returns boolean
language plpgsql stable security definer set search_path to ''
as $function$
begin
  return (
    select private.perm_scope(p_key) is not null
  );
end;
$function$;

create or replace function private.can(p_key text, p_owner uuid)
returns boolean
language plpgsql stable security definer set search_path to ''
as $function$
begin
  return (
    select case private.perm_scope(p_key)
      when 'all'  then true
      when 'team' then private.same_team(p_owner)
      when 'own'  then p_owner = auth.uid()
      else false
    end
  );
end;
$function$;

create or replace function private.fin_can(p_scope finance_scope, p_owner uuid, p_action text)
returns boolean
language plpgsql stable security definer set search_path to ''
as $function$
begin
  return (
    select case p_scope
      when 'empresa' then private.has_perm('finance.company.' || p_action)
      when 'pessoal' then p_owner = auth.uid() and private.has_perm('finance.personal.manage')
    end
  );
end;
$function$;

create or replace function private.same_team(p_user uuid)
returns boolean
language plpgsql stable security definer set search_path to ''
as $function$
begin
  return (
    select p_user = auth.uid() or exists (
      select 1
      from public.team_members a
      join public.team_members b on b.team_id = a.team_id
      where a.user_id = auth.uid() and b.user_id = p_user
    )
  );
end;
$function$;

create or replace function private.is_client_member(p_client uuid)
returns boolean
language plpgsql stable security definer set search_path to ''
as $function$
begin
  return (
    select p_client is not null and (
      exists (select 1 from public.client_members m where m.client_id = p_client and m.user_id = auth.uid())
      or exists (
        select 1 from public.team_clients tc
        join public.team_members tm on tm.team_id = tc.team_id
        where tc.client_id = p_client and tm.user_id = auth.uid()
      )
    )
  );
end;
$function$;

create or replace function private.is_client_lead_member(p_lead uuid)
returns boolean
language plpgsql stable security definer set search_path to ''
as $function$
begin
  return (
    select exists (
      select 1 from public.clients c
      where c.lead_id = p_lead and c.deleted_at is null and private.is_client_member(c.id)
    )
  );
end;
$function$;

create or replace function private.can_read_lead(p_lead uuid)
returns boolean
language plpgsql stable security definer set search_path to ''
as $function$
begin
  return (
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
    )
  );
end;
$function$;

create or replace function private.can_edit_lead(p_lead uuid)
returns boolean
language plpgsql stable security definer set search_path to ''
as $function$
begin
  return (
    select exists (
      select 1 from public.leads l
      where l.id = p_lead and l.organization_id = private.org_id() and l.deleted_at is null
        and private.can('crm.leads.update', l.owner_id)
    )
  );
end;
$function$;

create or replace function private.can_read_task(p_task uuid)
returns boolean
language plpgsql stable security definer set search_path to ''
as $function$
begin
  return (
    select exists (
      select 1 from public.tasks t
      where t.id = p_task and t.organization_id = private.org_id() and t.deleted_at is null
        and (private.can('tasks.read', t.owner_id) or t.created_by = auth.uid()
             or exists (select 1 from public.task_participants p where p.task_id = t.id and p.user_id = auth.uid())
             or (private.has_perm('tasks.read') and private.is_client_member(t.client_id)))
    )
  );
end;
$function$;

create or replace function private.can_read_conversation(p_conv uuid)
returns boolean
language plpgsql stable security definer set search_path to ''
as $function$
begin
  return (
    select exists (
      select 1 from public.conversations c
      where c.id = p_conv and c.organization_id = private.org_id()
        and (private.can('inbox.read', c.assignee_id) or (c.assignee_id is null and private.has_perm('inbox.read'))
             or (private.has_perm('inbox.read') and private.is_client_member(c.client_id)))
    )
  );
end;
$function$;

create or replace function private.can_read_transaction(p_id uuid)
returns boolean
language plpgsql stable security definer set search_path to ''
as $function$
begin
  return (
    select exists (
      select 1 from public.financial_transactions t
      where t.id = p_id and t.organization_id = private.org_id() and t.deleted_at is null
        and private.fin_can(t.scope, t.owner_user_id, 'read')
    )
  );
end;
$function$;

create or replace function private.can_read_client(p_client uuid)
returns boolean
language plpgsql stable security definer set search_path to ''
as $function$
begin
  return (
    select exists (
      select 1 from public.clients c
      where c.id = p_client and c.organization_id = private.org_id() and c.deleted_at is null
        and (private.can('clients.read', c.owner_id) or private.can_read_lead(c.lead_id)
             or (private.has_perm('clients.read') and private.is_client_member(c.id)))
    )
  );
end;
$function$;

create or replace function private.can_read_event(p_event uuid)
returns boolean
language plpgsql stable security definer set search_path to ''
as $function$
begin
  return (
    select exists (
      select 1 from public.calendar_events e
      where e.id = p_event and e.organization_id = private.org_id() and e.deleted_at is null
        and (private.can('calendar.read', e.owner_id)
             or exists (select 1 from public.event_attendees a where a.event_id = e.id and a.user_id = auth.uid())
             or (private.has_perm('calendar.read') and private.is_client_member(e.client_id)))
    )
  );
end;
$function$;

create or replace function private.can_manage_event(p_event uuid)
returns boolean
language plpgsql stable security definer set search_path to ''
as $function$
begin
  return (
    select auth.uid() is not null and exists (
      select 1 from public.calendar_events e
      where e.id = p_event and e.organization_id = private.org_id()
        and e.deleted_at is null and private.can('calendar.manage', e.owner_id)
    )
  );
end;
$function$;

create or replace function private.can_on_content(p_content uuid, p_key text)
returns boolean
language plpgsql stable security definer set search_path to ''
as $function$
begin
  return (
    select exists (
      select 1 from public.content_items c
      where c.id = p_content and c.organization_id = private.org_id()
        and (private.can(p_key, c.created_by)
             or (private.has_perm(p_key)
                 and (private.is_client_member(c.client_id)
                      or (c.task_id is not null and private.can_read_task(c.task_id)))))
    )
  );
end;
$function$;

create or replace function private.can_access_entity(p_type text, p_id uuid)
returns boolean
language plpgsql stable security definer set search_path to ''
as $function$
begin
  return (
    select case p_type
      when 'lead' then private.can_read_lead(p_id)
      when 'client' then private.can_read_client(p_id)
      when 'contract' then private.can_read_contract(p_id)
      when 'task' then private.can_read_task(p_id)
      when 'transaction' then private.can_read_transaction(p_id)
      else false
    end
  );
end;
$function$;

create or replace function private.is_ad_account_member(p_account uuid)
returns boolean
language plpgsql stable security definer set search_path to ''
as $function$
begin
  return (
    select exists (
      select 1 from public.ad_accounts a
      join public.ad_clients ac on ac.id = a.ad_client_id
      where a.id = p_account and a.organization_id = private.org_id() and private.is_client_member(ac.client_id)
    )
  );
end;
$function$;

create or replace function private.is_ad_client_member(p_ad_client uuid)
returns boolean
language plpgsql stable security definer set search_path to ''
as $function$
begin
  return (
    select exists (
      select 1 from public.ad_clients ac
      where ac.id = p_ad_client and ac.organization_id = private.org_id() and private.is_client_member(ac.client_id)
    )
  );
end;
$function$;

create or replace function private.storage_entity_ok(p_name text)
returns boolean
language plpgsql stable security definer set search_path to ''
as $function$
begin
  return (
    select (storage.foldername(p_name))[1] = private.org_id()::text
       and (storage.foldername(p_name))[3] ~ '^[0-9a-f-]{36}$'
       and private.can_access_entity((storage.foldername(p_name))[2], ((storage.foldername(p_name))[3])::uuid)
  );
end;
$function$;

