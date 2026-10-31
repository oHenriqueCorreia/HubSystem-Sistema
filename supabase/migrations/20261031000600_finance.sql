-- =============================================================================
-- Fase 5 · Financeiro (pessoal × empresa)
-- * scope = 'empresa' | 'pessoal' em contas, categorias, recorrências e lançamentos.
-- * Pessoal: só o dono lê/escreve. O administrador consulta apenas pela RPC
--   admin_read_personal_finance, que registra a consulta na auditoria.
-- * Dinheiro em centavos (bigint). "Vencido" é derivado (due_date < hoje e não pago).
-- =============================================================================

create type public.finance_scope as enum ('empresa', 'pessoal');
create type public.txn_kind as enum ('receita', 'despesa', 'transferencia');
create type public.txn_status as enum ('previsto', 'pago', 'cancelado');
create type public.account_type as enum ('corrente', 'poupanca', 'cartao', 'dinheiro', 'investimento', 'outro');
create type public.frequency as enum ('semanal', 'mensal', 'trimestral', 'semestral', 'anual');

create table public.financial_accounts (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  scope                  public.finance_scope not null,
  owner_user_id          uuid references public.profiles (id) on delete cascade,
  name                   text not null check (char_length(name) between 2 and 80),
  type                   public.account_type not null default 'corrente',
  opening_balance_cents  bigint not null default 0,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  check ((scope = 'pessoal') = (owner_user_id is not null))
);
create index financial_accounts_scope_idx on public.financial_accounts (organization_id, scope, owner_user_id);

create table public.financial_categories (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  scope            public.finance_scope not null,
  owner_user_id    uuid references public.profiles (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 80),
  kind             public.txn_kind not null check (kind in ('receita', 'despesa')),
  parent_id        uuid references public.financial_categories (id) on delete set null,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  check ((scope = 'pessoal') = (owner_user_id is not null))
);
create index financial_categories_scope_idx on public.financial_categories (organization_id, scope, owner_user_id);

create table public.cost_centers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 80),
  is_active        boolean not null default true
);

create table public.financial_recurrences (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  scope             public.finance_scope not null,
  owner_user_id     uuid references public.profiles (id) on delete cascade,
  frequency         public.frequency not null default 'mensal',
  start_date        date not null,
  end_date          date,
  template          jsonb not null,           -- kind, description, amount_cents, category_id, account_id, ...
  generated_until   date,
  is_active         boolean not null default true,
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  check ((scope = 'pessoal') = (owner_user_id is not null)),
  check (end_date is null or end_date >= start_date)
);

create table public.financial_transactions (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  scope                 public.finance_scope not null,
  owner_user_id         uuid references public.profiles (id) on delete cascade,
  kind                  public.txn_kind not null,
  description           text not null check (char_length(description) between 1 and 200),
  amount_cents          bigint not null check (amount_cents > 0),
  category_id           uuid references public.financial_categories (id) on delete set null,
  cost_center_id        uuid references public.cost_centers (id) on delete set null,
  account_id            uuid references public.financial_accounts (id) on delete restrict,
  transfer_account_id   uuid references public.financial_accounts (id) on delete restrict,
  payment_method        public.payment_method,
  competence_date       date not null,
  due_date              date not null,
  paid_at               date,
  paid_amount_cents     bigint check (paid_amount_cents >= 0),
  status                public.txn_status not null default 'previsto',
  installment_group_id  uuid,
  installment_number    int check (installment_number >= 1),
  installment_total     int check (installment_total >= 1),
  recurrence_id         uuid references public.financial_recurrences (id) on delete set null,
  client_id             uuid references public.clients (id) on delete set null,
  contract_id           uuid references public.contracts (id) on delete set null,
  reconciled_at         timestamptz,
  reconciled_by         uuid references auth.users (id) on delete set null,
  notes                 text check (char_length(notes) <= 5000),
  created_by            uuid default auth.uid() references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  check ((scope = 'pessoal') = (owner_user_id is not null)),
  check (status <> 'pago' or paid_at is not null),
  check (kind <> 'transferencia' or (transfer_account_id is not null and account_id is not null and transfer_account_id <> account_id)),
  check (scope = 'empresa' or (client_id is null and contract_id is null and cost_center_id is null)),
  check (installment_number is null or installment_number <= installment_total)
);
create index fin_txn_scope_due_idx on public.financial_transactions (organization_id, scope, owner_user_id, due_date) where deleted_at is null;
create index fin_txn_account_idx on public.financial_transactions (account_id, paid_at) where deleted_at is null;
create index fin_txn_competence_idx on public.financial_transactions (organization_id, scope, competence_date) where deleted_at is null;
create index fin_txn_contract_idx on public.financial_transactions (contract_id) where deleted_at is null;
create index fin_txn_group_idx on public.financial_transactions (installment_group_id);
create unique index fin_txn_recurrence_uq on public.financial_transactions (recurrence_id, due_date) where recurrence_id is not null and deleted_at is null;
create unique index fin_txn_contract_due_uq on public.financial_transactions (contract_id, due_date) where contract_id is not null and recurrence_id is null and deleted_at is null and kind = 'receita';
create trigger financial_transactions_updated_at before update on public.financial_transactions
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Acesso por contexto
-- -----------------------------------------------------------------------------
create or replace function private.fin_can(p_scope public.finance_scope, p_owner uuid, p_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_scope
    when 'empresa' then private.has_perm('finance.company.' || p_action)
    when 'pessoal' then p_owner = auth.uid() and private.has_perm('finance.personal.manage')
  end;
$$;

grant execute on function private.fin_can(public.finance_scope, uuid, text) to authenticated;

create or replace function private.can_read_transaction(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.financial_transactions t
    where t.id = p_id and t.organization_id = private.org_id() and t.deleted_at is null
      and private.fin_can(t.scope, t.owner_user_id, 'read')
  );
$$;

grant execute on function private.can_read_transaction(uuid) to authenticated;

-- Anexos e comprovantes de lançamentos passam a usar a mesma regra.
create or replace function private.can_access_entity(p_type text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_type
    when 'lead' then private.can_read_lead(p_id)
    when 'client' then private.can_read_client(p_id)
    when 'contract' then private.can_read_contract(p_id)
    when 'task' then private.can_read_task(p_id)
    when 'transaction' then private.can_read_transaction(p_id)
    else false
  end;
$$;

-- Coerência: conta/categoria do mesmo contexto (e do mesmo dono, se pessoal);
-- pessoal sempre do usuário atual; conciliação exige permissão própria.
create or replace function private.fin_txn_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if auth.uid() is null or current_setting('hub.trusted_op', true) = 'on' then
    return new;
  end if;

  if new.scope = 'pessoal' then
    if new.owner_user_id is distinct from auth.uid() then
      raise exception 'Lançamentos pessoais pertencem apenas a quem os cria.' using errcode = '42501';
    end if;
  end if;

  if new.account_id is not null then
    select (a.scope = new.scope and a.owner_user_id is not distinct from new.owner_user_id) into v_ok
      from public.financial_accounts a where a.id = new.account_id;
    if not coalesce(v_ok, false) then
      raise exception 'A conta escolhida não pertence a este contexto financeiro.' using errcode = 'P0001';
    end if;
  end if;
  if new.transfer_account_id is not null then
    select (a.scope = new.scope and a.owner_user_id is not distinct from new.owner_user_id) into v_ok
      from public.financial_accounts a where a.id = new.transfer_account_id;
    if not coalesce(v_ok, false) then
      raise exception 'A conta de destino não pertence a este contexto financeiro.' using errcode = 'P0001';
    end if;
  end if;
  if new.category_id is not null then
    select (c.scope = new.scope and c.owner_user_id is not distinct from new.owner_user_id and (new.kind = 'transferencia' or c.kind = new.kind)) into v_ok
      from public.financial_categories c where c.id = new.category_id;
    if not coalesce(v_ok, false) then
      raise exception 'A categoria escolhida não combina com este lançamento.' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.scope <> old.scope or new.owner_user_id is distinct from old.owner_user_id then
      raise exception 'Não é possível mudar o contexto de um lançamento.' using errcode = 'P0001';
    end if;
    -- Sem "editar", só é possível conciliar ou excluir: nenhum outro campo pode mudar.
    if new.scope = 'empresa' and not private.has_perm('finance.company.update')
       and (to_jsonb(new) - array['reconciled_at', 'reconciled_by', 'deleted_at', 'updated_at'])
           <> (to_jsonb(old) - array['reconciled_at', 'reconciled_by', 'deleted_at', 'updated_at']) then
      raise exception 'Você não tem permissão para editar lançamentos da empresa.' using errcode = '42501';
    end if;
    if (new.reconciled_at is distinct from old.reconciled_at)
       and new.scope = 'empresa' and not private.has_perm('finance.company.reconcile') then
      raise exception 'Você não tem permissão para conciliar.' using errcode = '42501';
    end if;
    if new.reconciled_at is not null and new.reconciled_at is not distinct from old.reconciled_at
       and (new.amount_cents <> old.amount_cents or new.paid_at is distinct from old.paid_at
            or new.paid_amount_cents is distinct from old.paid_amount_cents or new.account_id is distinct from old.account_id) then
      raise exception 'Lançamento conciliado: desfaça a conciliação antes de alterar valores, data ou conta.' using errcode = 'P0001';
    end if;
    if new.reconciled_at is distinct from old.reconciled_at then
      new.reconciled_by := case when new.reconciled_at is null then null else auth.uid() end;
    end if;
    if new.scope = 'empresa' and new.deleted_at is not null and old.deleted_at is null
       and not private.has_perm('finance.company.delete') then
      raise exception 'Você não tem permissão para excluir lançamentos.' using errcode = '42501';
    end if;
  end if;

  if new.status = 'pago' then
    new.paid_amount_cents := coalesce(new.paid_amount_cents, new.amount_cents);
  elsif new.status <> 'pago' then
    new.paid_at := null;
    new.paid_amount_cents := null;
    new.reconciled_at := null;
  end if;
  return new;
end;
$$;

create trigger fin_txn_guard before insert or update on public.financial_transactions
  for each row execute function private.fin_txn_guard();

-- Auditoria: só o financeiro da empresa (o pessoal não vai para o log geral).
create trigger audit_fin_txn_update after update on public.financial_transactions
  for each row when (new.scope = 'empresa')
  execute function private.audit_row('', 'amount_cents,paid_amount_cents,paid_at,status,due_date,competence_date,account_id,category_id,reconciled_at,deleted_at');
create trigger audit_fin_txn_delete after delete on public.financial_transactions
  for each row when (old.scope = 'empresa') execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------

-- Inserção atômica de vários lançamentos (parcelas).
create or replace function public.create_transactions(p_rows jsonb)
returns setof uuid
language sql
security invoker
set search_path = ''
as $$
  insert into public.financial_transactions (
    scope, owner_user_id, kind, description, amount_cents, category_id, cost_center_id, account_id, transfer_account_id,
    payment_method, competence_date, due_date, paid_at, status, installment_group_id, installment_number, installment_total,
    client_id, contract_id, notes
  )
  select (r ->> 'scope')::public.finance_scope,
         case when r ->> 'scope' = 'pessoal' then auth.uid() end,
         (r ->> 'kind')::public.txn_kind, r ->> 'description', (r ->> 'amount_cents')::bigint,
         nullif(r ->> 'category_id', '')::uuid, nullif(r ->> 'cost_center_id', '')::uuid,
         nullif(r ->> 'account_id', '')::uuid, nullif(r ->> 'transfer_account_id', '')::uuid,
         nullif(r ->> 'payment_method', '')::public.payment_method,
         (r ->> 'competence_date')::date, (r ->> 'due_date')::date, nullif(r ->> 'paid_at', '')::date,
         coalesce(nullif(r ->> 'status', ''), 'previsto')::public.txn_status,
         nullif(r ->> 'installment_group_id', '')::uuid, nullif(r ->> 'installment_number', '')::int,
         nullif(r ->> 'installment_total', '')::int,
         nullif(r ->> 'client_id', '')::uuid, nullif(r ->> 'contract_id', '')::uuid, nullif(r ->> 'notes', '')
  from jsonb_array_elements(p_rows) r
  returning id;
$$;

grant execute on function public.create_transactions(jsonb) to authenticated;

-- Próxima data de uma recorrência.
create or replace function private.next_date(p_date date, p_freq public.frequency, p_anchor_day int)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_freq
    when 'semanal' then p_date + 7
    else (
      with m as (
        select date_trunc('month', p_date) + (case p_freq when 'mensal' then 1 when 'trimestral' then 3 when 'semestral' then 6 else 12 end) * interval '1 month' as base
      )
      select (base + (least(p_anchor_day, extract(day from (base + interval '1 month' - interval '1 day'))::int) - 1) * interval '1 day')::date from m
    )
  end;
$$;

-- Materializa ocorrências das recorrências visíveis ao usuário até p_until.
create or replace function public.generate_recurrences(p_until date default null)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_until date := coalesce(p_until, ((now() at time zone 'America/Sao_Paulo')::date + interval '12 months')::date);
  v_rec record;
  v_date date;
  v_count int := 0;
  v_anchor int;
begin
  for v_rec in
    select * from public.financial_recurrences r
     where r.is_active and coalesce(r.generated_until, r.start_date - 1) < v_until
       and private.fin_can(r.scope, r.owner_user_id, 'create')
  loop
    v_anchor := extract(day from v_rec.start_date)::int;
    v_date := case when v_rec.generated_until is null then v_rec.start_date else private.next_date(v_rec.generated_until, v_rec.frequency, v_anchor) end;
    while v_date <= v_until and (v_rec.end_date is null or v_date <= v_rec.end_date) loop
      insert into public.financial_transactions (
        scope, owner_user_id, kind, description, amount_cents, category_id, cost_center_id, account_id,
        payment_method, competence_date, due_date, status, recurrence_id, client_id, contract_id
      ) values (
        v_rec.scope, v_rec.owner_user_id, (v_rec.template ->> 'kind')::public.txn_kind, v_rec.template ->> 'description',
        (v_rec.template ->> 'amount_cents')::bigint, nullif(v_rec.template ->> 'category_id', '')::uuid,
        nullif(v_rec.template ->> 'cost_center_id', '')::uuid, nullif(v_rec.template ->> 'account_id', '')::uuid,
        nullif(v_rec.template ->> 'payment_method', '')::public.payment_method, v_date, v_date, 'previsto', v_rec.id,
        nullif(v_rec.template ->> 'client_id', '')::uuid, nullif(v_rec.template ->> 'contract_id', '')::uuid
      ) on conflict do nothing;
      v_count := v_count + 1;
      update public.financial_recurrences set generated_until = v_date where id = v_rec.id;
      v_date := private.next_date(v_date, v_rec.frequency, v_anchor);
    end loop;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.generate_recurrences(date) to authenticated;

-- Contrato → contas a receber (previstas). Recorrentes viram recorrência.
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
  select k.*, c.lead_id into v_k from public.contracts k join public.clients c on c.id = k.client_id
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

grant execute on function public.contract_to_receivables(uuid, uuid, uuid) to authenticated;

-- Resumo do contexto: saldos por conta e totais do período (RLS aplicada).
create or replace function public.finance_summary(p_scope public.finance_scope, p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with today as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  txn as (
    select * from public.financial_transactions t
    where t.scope = p_scope and t.deleted_at is null and t.status <> 'cancelado'
      and (p_scope = 'empresa' or t.owner_user_id = auth.uid())
  ),
  accounts as (
    select a.id, a.name, a.type, a.opening_balance_cents,
      a.opening_balance_cents
      + coalesce((select sum(case when t.kind = 'receita' then t.paid_amount_cents when t.kind = 'despesa' then -t.paid_amount_cents else -t.paid_amount_cents end)
                  from txn t where t.account_id = a.id and t.status = 'pago'), 0)
      + coalesce((select sum(t.paid_amount_cents) from txn t where t.transfer_account_id = a.id and t.kind = 'transferencia' and t.status = 'pago'), 0) as balance
    from public.financial_accounts a
    where a.scope = p_scope and a.is_active and (p_scope = 'empresa' or a.owner_user_id = auth.uid())
  )
  select jsonb_build_object(
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'type', type, 'balance', balance) order by name) from accounts), '[]'::jsonb),
    'balance', coalesce((select sum(balance) from accounts), 0),
    'income_paid', coalesce((select sum(paid_amount_cents) from txn where kind = 'receita' and status = 'pago' and paid_at between p_from and p_to), 0),
    'expense_paid', coalesce((select sum(paid_amount_cents) from txn where kind = 'despesa' and status = 'pago' and paid_at between p_from and p_to), 0),
    'income_competence', coalesce((select sum(amount_cents) from txn where kind = 'receita' and competence_date between p_from and p_to), 0),
    'expense_competence', coalesce((select sum(amount_cents) from txn where kind = 'despesa' and competence_date between p_from and p_to), 0),
    'receivable_open', coalesce((select sum(amount_cents) from txn, today where kind = 'receita' and status = 'previsto' and due_date >= today.d), 0),
    'payable_open', coalesce((select sum(amount_cents) from txn, today where kind = 'despesa' and status = 'previsto' and due_date >= today.d), 0),
    'receivable_overdue', coalesce((select sum(amount_cents) from txn, today where kind = 'receita' and status = 'previsto' and due_date < today.d), 0),
    'payable_overdue', coalesce((select sum(amount_cents) from txn, today where kind = 'despesa' and status = 'previsto' and due_date < today.d), 0),
    'overdue_count', (select count(*) from txn, today where status = 'previsto' and kind <> 'transferencia' and due_date < today.d)
  );
$$;

grant execute on function public.finance_summary(public.finance_scope, date, date) to authenticated;

-- Consulta do administrador ao financeiro pessoal de outra pessoa (auditada).
create or replace function public.admin_read_personal_finance(p_user uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.has_perm('finance.personal.admin_read') then
    raise exception 'Você não tem permissão para consultar o financeiro pessoal de outros usuários.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and organization_id = private.org_id()) then
    raise exception 'Usuário não encontrado.' using errcode = 'P0002';
  end if;
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'Escolha um período de até 13 meses.' using errcode = 'P0001';
  end if;

  perform private.log_event('admin_read_personal_finance', 'profiles', p_user::text,
                            jsonb_build_object('de', p_from, 'ate', p_to));

  select jsonb_build_object(
    'transactions', coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'kind', t.kind, 'description', t.description, 'amount_cents', t.amount_cents, 'status', t.status,
      'due_date', t.due_date, 'paid_at', t.paid_at, 'category', c.name, 'account', a.name) order by t.due_date desc), '[]'::jsonb)
  ) into v_result
  from public.financial_transactions t
  left join public.financial_categories c on c.id = t.category_id
  left join public.financial_accounts a on a.id = t.account_id
  where t.scope = 'pessoal' and t.owner_user_id = p_user and t.deleted_at is null
    and t.due_date between p_from and p_to;

  return v_result;
end;
$$;

grant execute on function public.admin_read_personal_finance(uuid, date, date) to authenticated;

-- O dono vê quem consultou o seu financeiro pessoal.
create or replace function public.my_personal_finance_reads()
returns table (actor_id uuid, actor_name text, read_at timestamptz, period jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select l.actor_id, p.full_name, l.created_at, l.changes
  from public.audit_logs l
  left join public.profiles p on p.id = l.actor_id
  where l.action = 'admin_read_personal_finance' and l.entity_id = auth.uid()::text
  order by l.created_at desc
  limit 50;
$$;

grant execute on function public.my_personal_finance_reads() to authenticated;

-- Cria conta e categorias pessoais padrão para o usuário atual (idempotente).
create or replace function public.ensure_personal_defaults()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if not private.has_perm('finance.personal.manage') then
    return;
  end if;
  if not exists (select 1 from public.financial_accounts where scope = 'pessoal' and owner_user_id = v_me) then
    insert into public.financial_accounts (scope, owner_user_id, name, type) values ('pessoal', v_me, 'Conta pessoal', 'corrente');
  end if;
  if not exists (select 1 from public.financial_categories where scope = 'pessoal' and owner_user_id = v_me) then
    insert into public.financial_categories (scope, owner_user_id, name, kind)
    select 'pessoal', v_me, n, k::public.txn_kind from (values
      ('Salário / pró-labore', 'receita'), ('Outras receitas', 'receita'),
      ('Moradia', 'despesa'), ('Alimentação', 'despesa'), ('Transporte', 'despesa'), ('Saúde', 'despesa'),
      ('Educação', 'despesa'), ('Lazer', 'despesa'), ('Contas da casa', 'despesa'), ('Outras despesas', 'despesa')
    ) as x(n, k);
  end if;
end;
$$;

grant execute on function public.ensure_personal_defaults() to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.financial_accounts enable row level security;
alter table public.financial_categories enable row level security;
alter table public.cost_centers enable row level security;
alter table public.financial_recurrences enable row level security;
alter table public.financial_transactions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['financial_accounts', 'financial_categories', 'financial_recurrences'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using (organization_id = (select private.org_id()) and private.fin_can(scope, owner_user_id, 'read'));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check (organization_id = (select private.org_id())
                    and (scope = 'empresa' or owner_user_id = (select auth.uid()))
                    and private.fin_can(scope, owner_user_id, 'create'));
      create policy %1$s_update on public.%1$s for update to authenticated
        using (organization_id = (select private.org_id()) and private.fin_can(scope, owner_user_id, 'update'))
        with check (organization_id = (select private.org_id()) and private.fin_can(scope, owner_user_id, 'update'));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using (organization_id = (select private.org_id()) and private.fin_can(scope, owner_user_id, 'delete'));
    $f$, t);
  end loop;
end $$;

create policy cost_centers_select on public.cost_centers for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('finance.company.read')));
create policy cost_centers_write on public.cost_centers for all to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('finance.company.update')))
  with check (organization_id = (select private.org_id()) and (select private.has_perm('finance.company.update')));

create policy fin_txn_select on public.financial_transactions for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is null and private.fin_can(scope, owner_user_id, 'read'));
create policy fin_txn_insert on public.financial_transactions for insert to authenticated
  with check (organization_id = (select private.org_id())
              and (scope = 'empresa' or owner_user_id = (select auth.uid()))
              and private.fin_can(scope, owner_user_id, 'create'));
-- Atualizar: editar, conciliar ou excluir (exclusão lógica); o trigger valida cada caso.
create policy fin_txn_update on public.financial_transactions for update to authenticated
  using (organization_id = (select private.org_id())
         and (private.fin_can(scope, owner_user_id, 'update') or private.fin_can(scope, owner_user_id, 'reconcile')
              or private.fin_can(scope, owner_user_id, 'delete')))
  with check (organization_id = (select private.org_id()));

-- -----------------------------------------------------------------------------
-- Padrões da empresa
-- -----------------------------------------------------------------------------
insert into public.financial_accounts (organization_id, scope, name, type)
select id, 'empresa', 'Conta principal', 'corrente' from public.organizations;

insert into public.financial_categories (organization_id, scope, name, kind)
select o.id, 'empresa', c.name, c.kind::public.txn_kind
from public.organizations o
cross join (values
  ('Venda de sites', 'receita'), ('Manutenção de sites', 'receita'), ('Gestão de tráfego', 'receita'), ('Outras receitas', 'receita'),
  ('Ferramentas e software', 'despesa'), ('Hospedagem e domínios', 'despesa'), ('Verba de anúncios', 'despesa'),
  ('Impostos', 'despesa'), ('Pró-labore', 'despesa'), ('Marketing', 'despesa'), ('Terceirizados', 'despesa'), ('Outras despesas', 'despesa')
) as c(name, kind);

insert into public.cost_centers (organization_id, name)
select o.id, c.name from public.organizations o cross join (values ('Comercial'), ('Produção'), ('Administrativo')) as c(name);
