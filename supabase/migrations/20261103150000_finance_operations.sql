-- =============================================================================
-- Financeiro · cobrança, Pix, baixa, transferência entre áreas e extrato bancário
-- =============================================================================
--   * Lançamento ganha cliente/fornecedor em texto (o pessoal não tem "cliente") e motivo da cobrança.
--   * Dar baixa só vale para o que está em aberto: o valor conta uma única vez.
--   * Transferir entre empresa e pessoal é um movimento atômico e registrado.
--   * O extrato só grava depois da confirmação; conciliar não cria lançamento novo.
--   * Histórico de cada lançamento vale também para o pessoal, sem ir para a auditoria geral.
-- =============================================================================

alter table public.financial_transactions
  add column counterparty text check (char_length(counterparty) <= 160),
  add column charge_reason text check (charge_reason in ('mensalidade', 'boleto', 'servico', 'outro')),
  add column charge_note text check (char_length(charge_note) <= 200);

create or replace function public.create_transactions(p_rows jsonb)
returns setof uuid
language sql
security invoker
set search_path = ''
as $$
  insert into public.financial_transactions (
    scope, owner_user_id, kind, description, amount_cents, category_id, cost_center_id, account_id, transfer_account_id,
    payment_method, competence_date, due_date, paid_at, status, installment_group_id, installment_number, installment_total,
    client_id, contract_id, notes, counterparty, charge_reason, charge_note
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
         nullif(r ->> 'client_id', '')::uuid, nullif(r ->> 'contract_id', '')::uuid, nullif(r ->> 'notes', ''),
         nullif(r ->> 'counterparty', ''), nullif(r ->> 'charge_reason', ''), nullif(r ->> 'charge_note', '')
  from jsonb_array_elements(p_rows) r
  returning id;
$$;

-- -----------------------------------------------------------------------------
-- Histórico de correções e cancelamentos
-- -----------------------------------------------------------------------------
create table public.financial_txn_events (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  txn_id          uuid not null references public.financial_transactions (id) on delete cascade,
  action          text not null,
  changes         jsonb not null default '{}'::jsonb,
  actor_id        uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index financial_txn_events_txn_idx on public.financial_txn_events (txn_id, created_at desc);
alter table public.financial_txn_events enable row level security;
create policy financial_txn_events_select on public.financial_txn_events for select to authenticated
  using (organization_id = (select private.org_id()) and private.can_read_transaction(txn_id));

create or replace function private.fin_txn_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '{}'::jsonb;
  v_action text := 'correcao';
  k text;
begin
  foreach k in array array['description', 'amount_cents', 'paid_amount_cents', 'paid_at', 'status', 'due_date', 'competence_date', 'account_id', 'category_id', 'counterparty', 'charge_reason', 'reconciled_at', 'deleted_at'] loop
    if to_jsonb(new) -> k is distinct from to_jsonb(old) -> k then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('de', to_jsonb(old) -> k, 'para', to_jsonb(new) -> k));
    end if;
  end loop;
  if v_changes = '{}'::jsonb then
    return null;
  end if;
  if new.scope <> old.scope then v_action := 'transferencia';
  elsif new.deleted_at is not null and old.deleted_at is null then v_action := 'exclusao';
  elsif new.deleted_at is null and old.deleted_at is not null then v_action := 'restauracao';
  elsif new.status = 'cancelado' and old.status <> 'cancelado' then v_action := 'cancelamento';
  elsif new.status = 'pago' and old.status <> 'pago' then v_action := 'baixa';
  elsif new.status <> 'pago' and old.status = 'pago' then v_action := 'reabertura';
  elsif new.reconciled_at is distinct from old.reconciled_at then v_action := 'conciliacao';
  end if;
  insert into public.financial_txn_events (organization_id, txn_id, action, changes, actor_id)
  values (new.organization_id, new.id, v_action, v_changes, auth.uid());
  return null;
exception when others then
  raise warning 'fin_txn_history: %', sqlerrm;
  return null;
end;
$$;
create trigger fin_txn_history after update on public.financial_transactions
  for each row execute function private.fin_txn_history();

-- -----------------------------------------------------------------------------
-- Transferência entre empresa e pessoal
-- -----------------------------------------------------------------------------
create table public.financial_scope_transfers (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  txn_id            uuid not null references public.financial_transactions (id) on delete cascade,
  description       text not null,
  amount_cents      bigint not null,
  from_scope        public.finance_scope not null,
  to_scope          public.finance_scope not null,
  previous_category text,
  previous_account  text,
  previous_client   text,
  previous_cost_center text,
  previous_contract_id uuid,
  moved_by          uuid references auth.users (id) on delete set null,
  moved_at          timestamptz not null default now()
);
create index financial_scope_transfers_txn_idx on public.financial_scope_transfers (txn_id, moved_at desc);
alter table public.financial_scope_transfers enable row level security;
create policy financial_scope_transfers_select on public.financial_scope_transfers for select to authenticated
  using (organization_id = (select private.org_id()) and (moved_by = (select auth.uid()) or private.can_read_transaction(txn_id)));

create or replace function public.transfer_transaction_scope(p_id uuid, p_category uuid, p_account uuid)
returns public.finance_scope
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.financial_transactions;
  v_to public.finance_scope;
  v_owner uuid;
  v_ok boolean;
begin
  select * into t from public.financial_transactions
   where id = p_id and organization_id = private.org_id() and deleted_at is null for update;
  if t.id is null or not private.fin_can(t.scope, t.owner_user_id, 'update') then
    raise exception 'Lançamento não encontrado.' using errcode = 'P0002';
  end if;
  v_to := case t.scope when 'empresa' then 'pessoal' else 'empresa' end;
  v_owner := case v_to when 'pessoal' then auth.uid() end;
  if not private.fin_can(v_to, v_owner, 'create') then
    raise exception 'Você não tem acesso à área de destino.' using errcode = '42501';
  end if;
  if t.kind = 'transferencia' then
    raise exception 'Transferências entre contas não mudam de área: crie o lançamento na área certa.' using errcode = 'P0001';
  end if;
  -- Contrato e recorrência gerariam a parcela de novo na área de origem.
  if t.contract_id is not null then
    raise exception 'Este lançamento vem de um contrato. Altere o contrato em vez de transferir.' using errcode = 'P0001';
  end if;
  if t.recurrence_id is not null then
    raise exception 'Este lançamento vem de uma recorrência. Encerre a recorrência e crie na área certa.' using errcode = 'P0001';
  end if;
  if t.status = 'pago' and p_account is null then
    raise exception 'Escolha a conta de destino: o valor já pago entra no saldo dela.' using errcode = 'P0001';
  end if;
  if p_account is not null then
    select (a.scope = v_to and a.owner_user_id is not distinct from v_owner and a.organization_id = t.organization_id) into v_ok from public.financial_accounts a where a.id = p_account;
    if not coalesce(v_ok, false) then
      raise exception 'A conta escolhida não pertence à área de destino.' using errcode = 'P0001';
    end if;
  end if;
  if p_category is not null then
    select (c.scope = v_to and c.owner_user_id is not distinct from v_owner and c.kind = t.kind and c.organization_id = t.organization_id) into v_ok from public.financial_categories c where c.id = p_category;
    if not coalesce(v_ok, false) then
      raise exception 'A categoria escolhida não pertence à área de destino.' using errcode = 'P0001';
    end if;
  end if;

  insert into public.financial_scope_transfers (organization_id, txn_id, description, amount_cents, from_scope, to_scope, previous_category, previous_account, previous_client, previous_cost_center, previous_contract_id, moved_by)
  values (t.organization_id, t.id, t.description, t.amount_cents, t.scope, v_to,
          (select name from public.financial_categories where id = t.category_id),
          (select name from public.financial_accounts where id = t.account_id),
          (select coalesce(c.legal_name, l.name) from public.clients c join public.leads l on l.id = c.lead_id where c.id = t.client_id),
          (select name from public.cost_centers where id = t.cost_center_id),
          t.contract_id, auth.uid());

  perform set_config('hub.trusted_op', 'on', true);
  update public.financial_transactions
     set scope = v_to, owner_user_id = v_owner, category_id = p_category, account_id = p_account, transfer_account_id = null,
         cost_center_id = null, contract_id = null,
         -- O nome do cliente continua no lançamento quando ele vai para o pessoal.
         counterparty = coalesce(counterparty, (select coalesce(c.legal_name, l.name) from public.clients c join public.leads l on l.id = c.lead_id where c.id = t.client_id)),
         client_id = case when v_to = 'empresa' then client_id end
   where id = t.id;
  perform set_config('hub.trusted_op', 'off', true);
  return v_to;
end;
$$;
revoke execute on function public.transfer_transaction_scope(uuid, uuid, uuid) from public, anon;
grant execute on function public.transfer_transaction_scope(uuid, uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Dados de recebimento: um cadastro para a empresa e um para cada pessoa
-- -----------------------------------------------------------------------------
create table public.payment_profiles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  scope           public.finance_scope not null,
  owner_user_id   uuid references public.profiles (id) on delete cascade,
  pix_key         text not null check (char_length(pix_key) between 1 and 140),
  pix_key_type    text not null check (pix_key_type in ('cnpj', 'cpf', 'email', 'telefone', 'aleatoria')),
  holder_name     text not null check (char_length(holder_name) between 1 and 160),
  bank_name       text check (char_length(bank_name) <= 80),
  instructions    text check (char_length(instructions) <= 500),
  updated_at      timestamptz not null default now(),
  check ((scope = 'pessoal') = (owner_user_id is not null))
);
create unique index payment_profiles_company_uq on public.payment_profiles (organization_id) where scope = 'empresa';
create unique index payment_profiles_personal_uq on public.payment_profiles (organization_id, owner_user_id) where scope = 'pessoal';
alter table public.payment_profiles enable row level security;
create policy payment_profiles_select on public.payment_profiles for select to authenticated
  using (organization_id = (select private.org_id()) and private.fin_can(scope, owner_user_id, 'read'));
create policy payment_profiles_write on public.payment_profiles for all to authenticated
  using (organization_id = (select private.org_id()) and private.fin_can(scope, owner_user_id, 'update'))
  with check (organization_id = (select private.org_id()) and private.fin_can(scope, owner_user_id, 'update'));

create table public.charge_messages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  txn_id          uuid not null references public.financial_transactions (id) on delete cascade,
  phone           text not null,
  body            text not null check (char_length(body) between 1 and 4096),
  status          text not null check (status in ('enviada', 'erro')),
  error           text check (char_length(error) <= 500),
  sent_by         uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index charge_messages_txn_idx on public.charge_messages (txn_id, created_at desc);
alter table public.charge_messages enable row level security;
create policy charge_messages_select on public.charge_messages for select to authenticated
  using (organization_id = (select private.org_id()) and private.can_read_transaction(txn_id));
create policy charge_messages_insert on public.charge_messages for insert to authenticated
  with check (organization_id = (select private.org_id()) and private.can_read_transaction(txn_id));

-- -----------------------------------------------------------------------------
-- Extrato bancário
-- -----------------------------------------------------------------------------
create table public.categorization_rules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  scope           public.finance_scope not null,
  owner_user_id   uuid references public.profiles (id) on delete cascade,
  pattern         text not null check (char_length(btrim(pattern)) between 2 and 80),
  category_id     uuid not null references public.financial_categories (id) on delete cascade,
  created_at      timestamptz not null default now(),
  check ((scope = 'pessoal') = (owner_user_id is not null))
);
create unique index categorization_rules_uq on public.categorization_rules (organization_id, scope, coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(pattern));
alter table public.categorization_rules enable row level security;
create policy categorization_rules_select on public.categorization_rules for select to authenticated
  using (organization_id = (select private.org_id()) and private.fin_can(scope, owner_user_id, 'read'));
create policy categorization_rules_write on public.categorization_rules for all to authenticated
  using (organization_id = (select private.org_id()) and private.fin_can(scope, owner_user_id, 'update'))
  with check (organization_id = (select private.org_id()) and private.fin_can(scope, owner_user_id, 'update'));

create table public.statement_imports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  file_name       text not null check (char_length(file_name) <= 200),
  file_format     text not null,
  created_count   int not null default 0,
  reconciled_count int not null default 0,
  ignored_count   int not null default 0,
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);
alter table public.statement_imports enable row level security;
create policy statement_imports_own on public.statement_imports for select to authenticated
  using (organization_id = (select private.org_id()) and created_by = (select auth.uid()));
create policy statement_imports_insert on public.statement_imports for insert to authenticated
  with check (organization_id = (select private.org_id()));

create table public.statement_lines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  import_id       uuid not null references public.statement_imports (id) on delete cascade,
  line_hash       text not null,
  line_date       date not null,
  description     text not null check (char_length(description) <= 300),
  amount_cents    bigint not null check (amount_cents > 0),
  direction       text not null check (direction in ('entrada', 'saida')),
  action          text not null check (action in ('criado', 'conciliado', 'ignorado')),
  txn_id          uuid references public.financial_transactions (id) on delete set null,
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index statement_lines_hash_idx on public.statement_lines (organization_id, line_hash);
alter table public.statement_lines enable row level security;
-- O extrato de uma pessoa não aparece para outra; o lançamento gerado segue as regras da área dele.
create policy statement_lines_own on public.statement_lines for select to authenticated
  using (organization_id = (select private.org_id()) and created_by = (select auth.uid()));

-- Grava a revisão inteira numa transação: se uma linha falhar, nada é gravado.
create or replace function public.commit_statement(p_file text, p_format text, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r jsonb;
  v_import uuid;
  v_txn uuid;
  v_created int := 0;
  v_reconciled int := 0;
  v_ignored int := 0;
  v_action text;
  v_date date;
  v_amount bigint;
  v_direction text;
  v_scope public.finance_scope;
  v_kind public.txn_kind;
begin
  insert into public.statement_imports (file_name, file_format) values (left(p_file, 200), p_format) returning id into v_import;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_action := r ->> 'action';
    v_date := (r ->> 'date')::date;
    v_amount := (r ->> 'amount_cents')::bigint;
    v_direction := r ->> 'direction';
    v_kind := case v_direction when 'entrada' then 'receita' else 'despesa' end;
    v_txn := null;
    if v_action = 'criar' then
      v_scope := (r ->> 'scope')::public.finance_scope;
      insert into public.financial_transactions (scope, owner_user_id, kind, description, amount_cents, paid_amount_cents, category_id, account_id, competence_date, due_date, paid_at, status, reconciled_at, counterparty)
      values (v_scope, case when v_scope = 'pessoal' then auth.uid() end, v_kind, left(r ->> 'description', 200), v_amount, v_amount,
              nullif(r ->> 'category_id', '')::uuid, nullif(r ->> 'account_id', '')::uuid, v_date, v_date, v_date, 'pago', now(), nullif(r ->> 'counterparty', ''))
      returning id into v_txn;
      v_created := v_created + 1;
    elsif v_action = 'conciliar' then
      -- Liga ao lançamento existente: nenhuma entrada nova, e o valor conta uma vez só.
      update public.financial_transactions t
         set status = 'pago',
             paid_at = coalesce(t.paid_at, v_date),
             paid_amount_cents = coalesce(t.paid_amount_cents, v_amount),
             account_id = coalesce(t.account_id, nullif(r ->> 'account_id', '')::uuid),
             reconciled_at = now()
       where t.id = (r ->> 'txn_id')::uuid and t.deleted_at is null and t.kind = v_kind and t.status <> 'cancelado' and t.reconciled_at is null
      returning t.id into v_txn;
      if v_txn is null then
        raise exception 'A linha "%" não pode ser conciliada: o lançamento mudou ou já foi conciliado.', left(r ->> 'description', 60) using errcode = 'P0001';
      end if;
      v_reconciled := v_reconciled + 1;
    else
      v_ignored := v_ignored + 1;
    end if;
    insert into public.statement_lines (import_id, line_hash, line_date, description, amount_cents, direction, action, txn_id)
    values (v_import, r ->> 'hash', v_date, left(r ->> 'description', 300), v_amount, v_direction,
            case v_action when 'criar' then 'criado' when 'conciliar' then 'conciliado' else 'ignorado' end, v_txn);
  end loop;
  update public.statement_imports set created_count = v_created, reconciled_count = v_reconciled, ignored_count = v_ignored where id = v_import;
  return jsonb_build_object('criados', v_created, 'conciliados', v_reconciled, 'ignorados', v_ignored);
end;
$$;
revoke execute on function public.commit_statement(text, text, jsonb) from public, anon;
grant execute on function public.commit_statement(text, text, jsonb) to authenticated;

grant insert on public.statement_lines to authenticated;
create policy statement_lines_insert on public.statement_lines for insert to authenticated
  with check (organization_id = (select private.org_id()));
