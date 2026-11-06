-- =============================================================================
-- Permissões por campo: valores de contrato e dados de cobrança
-- =============================================================================
-- Antes: quem podia ler um contrato via o valor; quem podia ler um cliente via
-- CPF/CNPJ, e-mail e telefone de cobrança (inclusive o papel Somente leitura).
-- Agora:
--   * contracts.values → valor dos contratos e preço padrão dos serviços.
--   * clients.billing  → CPF/CNPJ, e-mail e telefone de cobrança.
-- Garantia no banco: usuários da API não leem essas colunas diretamente
-- (privilégio de coluna). Os valores saem só pelas funções contract_values,
-- service_prices e client_billing, que conferem a permissão e a visibilidade
-- do registro. Gravar esses campos também exige a permissão.
-- Quem já cria/edita contratos ou clientes, ou cuida do financeiro, recebe as
-- permissões novas: ninguém perde o que usa no dia a dia. Quem só consulta
-- (ex.: Somente leitura) deixa de ver valores e documentos.
-- ATENÇÃO para migrations futuras: coluna nova em contracts, clients ou
-- services precisa de "grant select (coluna) ... to authenticated".
-- =============================================================================

insert into public.permissions (key, module, label, description, position) values
  ('clients.billing',  'Clientes',  'Ver e editar CPF/CNPJ e contatos de cobrança', 'Documento, e-mail e telefone de cobrança do cliente.', 34),
  ('contracts.values', 'Contratos', 'Ver e definir valores de contratos', 'Valor dos contratos, receita recorrente e preço padrão dos serviços.', 44)
on conflict (key) do nothing;

-- Quem já lida com contratos/clientes ou com o financeiro continua vendo os valores.
create or replace function private.seed_field_permissions(p_org uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.role_permissions (role_id, permission_key, scope)
  select distinct r.id, x.target, 'all'::public.permission_scope
  from public.roles r
  join public.role_permissions rp on rp.role_id = r.id
  join (values
    ('contracts.values', 'contracts.create'), ('contracts.values', 'contracts.update'), ('contracts.values', 'finance.company.read'),
    ('clients.billing', 'clients.create'), ('clients.billing', 'clients.update'), ('clients.billing', 'finance.company.read')
  ) as x(target, source) on x.source = rp.permission_key
  where r.organization_id = p_org
  on conflict (role_id, permission_key) do nothing;
  -- Administrador tem tudo.
  insert into public.role_permissions (role_id, permission_key, scope)
  select r.id, k.key, 'all'
  from public.roles r cross join (values ('contracts.values'), ('clients.billing')) as k(key)
  where r.organization_id = p_org and r.key = 'admin'
  on conflict (role_id, permission_key) do nothing;
$$;

select private.seed_field_permissions(id) from public.organizations;

create or replace function private.organizations_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.bootstrap_organization(new.id);
  perform private.seed_module_permissions(new.id);
  perform private.seed_task_columns(new.id);
  perform private.seed_field_permissions(new.id);
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Leitura das colunas: tudo, menos as sensíveis
-- -----------------------------------------------------------------------------
do $$
declare
  v_table text;
  v_hidden text[];
  v_cols text;
begin
  for v_table, v_hidden in
    select * from (values
      ('contracts', array['amount_cents']),
      ('clients',   array['document', 'billing_email', 'billing_phone_e164']),
      ('services',  array['default_price_cents'])
    ) as t(tbl, hidden)
  loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns
    where table_schema = 'public' and table_name = v_table and column_name <> all (v_hidden);
    execute format('revoke select on public.%I from authenticated, anon', v_table);
    execute format('grant select (%s) on public.%I to authenticated', v_cols, v_table);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Leitura autorizada
-- -----------------------------------------------------------------------------
-- Uso interno (funções que já conferiram o acesso). O esquema private não é exposto pela API.
create or replace function private.contract_amount(p_contract uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select k.amount_cents from public.contracts k where k.id = p_contract and k.organization_id = private.org_id();
$$;

create or replace function public.contract_values(p_ids uuid[])
returns table (id uuid, amount_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select k.id, k.amount_cents
  from public.contracts k
  where k.id = any (p_ids) and k.organization_id = private.org_id()
    and private.has_perm('contracts.values') and private.can_read_contract(k.id);
$$;

create or replace function public.service_prices()
returns table (id uuid, default_price_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.default_price_cents
  from public.services s
  where s.organization_id = private.org_id() and private.has_perm('contracts.values');
$$;

create or replace function public.client_billing(p_ids uuid[])
returns table (id uuid, document text, billing_email text, billing_phone_e164 text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.document, c.billing_email, c.billing_phone_e164
  from public.clients c
  where c.id = any (p_ids) and c.organization_id = private.org_id()
    and private.has_perm('clients.billing') and private.can_read_client(c.id);
$$;

revoke execute on function private.contract_amount(uuid) from public, anon;
grant execute on function private.contract_amount(uuid) to authenticated, service_role;
revoke execute on function public.contract_values(uuid[]), public.service_prices(), public.client_billing(uuid[]) from public, anon;
grant execute on function public.contract_values(uuid[]), public.service_prices(), public.client_billing(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Gravação: sem a permissão, os campos sensíveis não mudam
-- -----------------------------------------------------------------------------
create or replace function private.field_permission_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or current_setting('hub.trusted_op', true) = 'on' then
    return new;
  end if;

  if tg_table_name = 'contracts' then
    if (tg_op = 'INSERT' or new.amount_cents is distinct from old.amount_cents)
       and not private.has_perm('contracts.values') then
      raise exception 'Você não tem permissão para definir valores de contratos.'
        using errcode = '42501', hint = 'field_permission';
    end if;
  elsif tg_table_name = 'clients' then
    if (case when tg_op = 'INSERT'
          then coalesce(new.document, new.billing_email, new.billing_phone_e164) is not null
          else (new.document, new.billing_email, new.billing_phone_e164) is distinct from (old.document, old.billing_email, old.billing_phone_e164) end)
       and not private.has_perm('clients.billing') then
      raise exception 'Você não tem permissão para alterar os dados de cobrança do cliente.'
        using errcode = '42501', hint = 'field_permission';
    end if;
  elsif tg_table_name = 'services' then
    if (tg_op = 'INSERT' and new.default_price_cents is not null
        or tg_op = 'UPDATE' and new.default_price_cents is distinct from old.default_price_cents)
       and not private.has_perm('contracts.values') then
      raise exception 'Você não tem permissão para definir preços de serviços.'
        using errcode = '42501', hint = 'field_permission';
    end if;
  end if;
  return new;
end;
$$;

create trigger contracts_field_guard before insert or update on public.contracts
  for each row execute function private.field_permission_guard();
create trigger clients_field_guard before insert or update on public.clients
  for each row execute function private.field_permission_guard();
create trigger services_field_guard before insert or update on public.services
  for each row execute function private.field_permission_guard();

-- -----------------------------------------------------------------------------
-- Funções que liam o valor direto da tabela
-- -----------------------------------------------------------------------------
create or replace function public.contract_to_receivables(p_contract uuid, p_account uuid default null, p_category uuid default null)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_k record;
  v_first date;
  v_freq public.frequency;
  v_count int;
begin
  if not private.has_perm('finance.company.create') then
    raise exception 'Você não tem permissão para lançar no financeiro da empresa.' using errcode = '42501';
  end if;
  -- Colunas explícitas: o valor vem do auxiliar privado (a coluna não é legível pela API).
  select k.id, k.title, k.payment_method, k.start_date, k.end_date, k.due_day, k.recurrence, k.client_id,
         private.contract_amount(k.id) as amount_cents, c.lead_id
    into v_k from public.contracts k join public.clients c on c.id = k.client_id
   where k.id = p_contract and k.deleted_at is null;
  if v_k.id is null then
    raise exception 'Contrato não encontrado.' using errcode = 'P0002';
  end if;

  v_first := case when v_k.due_day is null then v_k.start_date
                  else make_date(extract(year from v_k.start_date)::int, extract(month from v_k.start_date)::int,
                                 least(v_k.due_day, extract(day from (date_trunc('month', v_k.start_date) + interval '1 month' - interval '1 day'))::int)) end;
  if v_first < v_k.start_date then
    v_first := private.next_date(v_first, 'mensal', coalesce(v_k.due_day, extract(day from v_first)::int));
  end if;

  if v_k.recurrence = 'unica' then
    insert into public.financial_transactions (scope, kind, description, amount_cents, category_id, account_id, payment_method,
      competence_date, due_date, status, client_id, contract_id)
    values ('empresa', 'receita', v_k.title, v_k.amount_cents, p_category, p_account, v_k.payment_method,
      v_k.start_date, v_first, 'previsto', v_k.client_id, v_k.id)
    on conflict do nothing;
    get diagnostics v_count = row_count;
    return v_count;
  end if;

  v_freq := case v_k.recurrence when 'mensal' then 'mensal' when 'trimestral' then 'trimestral' when 'semestral' then 'semestral' else 'anual' end::public.frequency;
  if exists (select 1 from public.financial_recurrences where template ->> 'contract_id' = p_contract::text and is_active) then
    raise exception 'As cobranças deste contrato já foram geradas.' using errcode = 'P0001';
  end if;
  insert into public.financial_recurrences (scope, frequency, start_date, end_date, template)
  values ('empresa', v_freq, v_first, v_k.end_date, jsonb_build_object(
    'kind', 'receita', 'description', v_k.title, 'amount_cents', v_k.amount_cents, 'category_id', coalesce(p_category::text, ''),
    'account_id', coalesce(p_account::text, ''), 'payment_method', v_k.payment_method, 'client_id', v_k.client_id, 'contract_id', v_k.id));
  return public.generate_recurrences(null);
end;
$$;

create or replace function public.commercial_dashboard(p_from date, p_to date, p_owner uuid default null, p_pipeline uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with
  bounds as (
    select (p_from::timestamp at time zone 'America/Sao_Paulo') as t0,
           ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo') as t1
  ),
  -- Valores de contrato só para quem tem contracts.values; os demais veem contagens.
  vals as (select private.has_perm('contracts.values') as ok),
  pipe as (
    select coalesce(p_pipeline, (select id from public.pipelines where is_active order by position limit 1)) as id
  ),
  d as (
    select d.* from public.deals d, pipe
    where d.deleted_at is null and d.pipeline_id = pipe.id and (p_owner is null or d.owner_id = p_owner)
  ),
  hist as (
    select h.*, s.name as stage_name, s.kind from public.deal_stage_history h
    join d on d.id = h.deal_id
    join public.stages s on s.id = h.to_stage_id, bounds
    where h.moved_at >= bounds.t0 and h.moved_at < bounds.t1
  ),
  won as (select * from d, bounds where d.won_at >= bounds.t0 and d.won_at < bounds.t1),
  lost as (select * from d, bounds where d.lost_at >= bounds.t0 and d.lost_at < bounds.t1),
  k as (
    select k.id, k.owner_id, k.status, k.recurrence, k.start_date,
           case when (select ok from vals) then private.contract_amount(k.id) end as amount_cents,
           s.name as service_name
    from public.contracts k
    left join public.services s on s.id = k.service_id
    where k.deleted_at is null and k.status <> 'cancelado' and (p_owner is null or k.owner_id = p_owner)
  ),
  kp as (select * from k where k.start_date between p_from and p_to),
  leads_in as (
    select l.* from public.leads l, bounds
    where l.deleted_at is null and (p_owner is null or l.owner_id = p_owner)
  )
  select jsonb_build_object(
    'values_hidden', not (select ok from vals),
    'total_leads', (select count(*) from leads_in),
    'new_leads', (select count(*) from leads_in, bounds where leads_in.created_at >= bounds.t0 and leads_in.created_at < bounds.t1),
    'by_stage', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'count', (select count(*) from d where d.stage_id = s.id),
                                          'amount', (select coalesce(sum(d.amount_cents), 0) from d where d.stage_id = s.id)) order by s.position)
      from public.stages s, pipe where s.pipeline_id = pipe.id), '[]'::jsonb),
    'by_owner', coalesce((
      select jsonb_agg(x order by (x ->> 'count')::int desc) from (
        select jsonb_build_object('owner_id', d.owner_id, 'name', coalesce(p.full_name, 'Sem responsável'), 'count', count(*),
                                  'won', count(*) filter (where d.won_at is not null)) as x
        from d left join public.profiles p on p.id = d.owner_id
        group by d.owner_id, p.full_name
      ) t), '[]'::jsonb),
    'meetings', (select count(*) from public.calendar_events e, bounds
                 where e.deleted_at is null and e.kind = 'reuniao' and e.starts_at >= bounds.t0 and e.starts_at < bounds.t1
                   and (p_owner is null or e.owner_id = p_owner)),
    'meetings_stage', (select count(distinct deal_id) from hist where stage_name ilike 'reuni%'),
    'proposals', (select count(distinct deal_id) from hist where stage_name ilike 'proposta%'),
    'won', (select count(*) from won),
    'lost', (select count(*) from lost),
    'lost_reasons', coalesce((
      select jsonb_agg(jsonb_build_object('name', coalesce(r.name, 'Sem motivo'), 'count', c) order by c desc)
      from (select lost_reason_id, count(*) c from lost group by lost_reason_id) x
      left join public.lost_reasons r on r.id = x.lost_reason_id), '[]'::jsonb),
    'revenue', (select coalesce(sum(amount_cents), 0) from kp),
    'contracts', (select count(*) from kp),
    'mrr', (select coalesce(sum(case recurrence when 'mensal' then amount_cents when 'trimestral' then amount_cents / 3
                                                 when 'semestral' then amount_cents / 6 when 'anual' then amount_cents / 12 else 0 end), 0)
            from k where status = 'ativo'),
    'by_month', coalesce((
      select jsonb_agg(jsonb_build_object('month', m, 'amount', amount, 'count', cnt) order by m)
      from (select to_char(start_date, 'YYYY-MM') m, sum(amount_cents) amount, count(*) cnt
            from k where start_date >= (p_to - interval '11 months')::date and start_date <= p_to group by 1) x), '[]'::jsonb),
    'by_service', coalesce((
      select jsonb_agg(jsonb_build_object('name', coalesce(service_name, 'Outros'), 'amount', amount, 'count', cnt) order by amount desc)
      from (select service_name, sum(amount_cents) amount, count(*) cnt from kp group by service_name) x), '[]'::jsonb),
    'pipeline_open_amount', (select coalesce(sum(d.amount_cents), 0) from d join public.stages s on s.id = d.stage_id where s.kind = 'open'),
    'forecast', coalesce((
      select jsonb_agg(jsonb_build_object('month', m, 'amount', amount) order by m)
      from (select to_char(expected_close_date, 'YYYY-MM') m, sum(d.amount_cents) amount
            from d join public.stages s on s.id = d.stage_id
            where s.kind = 'open' and d.expected_close_date is not null and d.amount_cents is not null
              and d.expected_close_date between (now() at time zone 'America/Sao_Paulo')::date and ((now() at time zone 'America/Sao_Paulo')::date + 90)
            group by 1) x), '[]'::jsonb),
    'overdue_tasks', (select count(*) from public.tasks t where t.deleted_at is null and t.status in ('a_fazer', 'em_andamento')
                        and t.due_at < now() and (p_owner is null or t.owner_id = p_owner)),
    'overdue_contacts', (select count(*) from leads_in where next_contact_at < now())
  );
$$;
