-- HubSystem · migrations pendentes (20261102090000 em diante) em um único script.
-- Como usar: Supabase → SQL Editor → New query → cole TODO este arquivo → Run.
-- Tudo roda numa transação: se algo falhar, nada é aplicado. Rode uma única vez.
-- Gerado a partir de supabase/migrations/. Não edite à mão.

begin;

-- ===== supabase/migrations/20261102090000_ad_clients_utms.sql
-- =============================================================================
-- Anúncios · clientes e UTMs
-- =============================================================================
--   * ad_clients: agrupa contas de anúncio por cliente (um cliente pode ter
--     várias contas, de Meta e de Google). Cada cliente tem o próprio painel.
--   * utm_links: links de rastreamento salvos (URL de destino + parâmetros UTM),
--     opcionalmente ligados a um cliente.
--   * Leitura: ads.read. Escrita: ads.manage.
-- =============================================================================

create table public.ad_clients (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 1 and 120),
  created_at       timestamptz not null default now()
);
create unique index ad_clients_org_name_uq on public.ad_clients (organization_id, lower(name));

alter table public.ad_accounts add column ad_client_id uuid references public.ad_clients (id) on delete set null;
create index ad_accounts_client_idx on public.ad_accounts (ad_client_id);

create table public.utm_links (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  ad_client_id     uuid references public.ad_clients (id) on delete set null,
  name             text not null check (char_length(btrim(name)) between 1 and 120),
  base_url         text not null check (base_url ~ '^https?://' and char_length(base_url) <= 2000),
  utm_source       text not null check (char_length(utm_source) between 1 and 200),
  utm_medium       text not null check (char_length(utm_medium) between 1 and 200),
  utm_campaign     text not null check (char_length(utm_campaign) between 1 and 300),
  utm_content      text check (char_length(utm_content) <= 300),
  utm_term         text check (char_length(utm_term) <= 300),
  created_by       uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index utm_links_org_idx on public.utm_links (organization_id, created_at desc);

alter table public.ad_clients enable row level security;
alter table public.utm_links enable row level security;

create policy ad_clients_select on public.ad_clients for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('ads.read')));
create policy ad_clients_write on public.ad_clients for all to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('ads.manage')))
  with check (organization_id = (select private.org_id()) and (select private.has_perm('ads.manage')));

create policy utm_links_select on public.utm_links for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('ads.read')));
create policy utm_links_write on public.utm_links for all to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('ads.manage')))
  with check (organization_id = (select private.org_id()) and (select private.has_perm('ads.manage')));

-- Conta e UTM só podem apontar para um cliente da mesma organização.
create or replace function private.ad_account_client_same_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ad_client_id is not null
     and not exists (select 1 from public.ad_clients c where c.id = new.ad_client_id and c.organization_id = new.organization_id) then
    raise exception 'Cliente de outra organização.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger ad_accounts_client_same_org before insert or update of ad_client_id on public.ad_accounts
  for each row execute function private.ad_account_client_same_org();
create trigger utm_links_client_same_org before insert or update of ad_client_id on public.utm_links
  for each row execute function private.ad_account_client_same_org();

insert into supabase_migrations.schema_migrations (version, name) values ('20261102090000', 'ad_clients_utms') on conflict do nothing;

-- ===== supabase/migrations/20261102100000_finance_business_day.sql
-- =============================================================================
-- Financeiro · vencimento no N-ésimo dia útil (ex.: 5º dia útil do mês)
-- =============================================================================
--   * Dia útil: segunda a sexta, fora feriados nacionais e bancários
--     (inclui Carnaval, Sexta-feira Santa e Corpus Christi, móveis pela Páscoa).
--   * financial_recurrences.due_rule: 'dia_fixo' (dia do mês da data inicial,
--     comportamento anterior) ou 'dia_util' (business_day = 1..23).
--   * Se o mês tiver menos dias úteis que o pedido, vence no último dia útil.
-- =============================================================================

-- Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher).
create or replace function private.easter(p_year int)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  a int := p_year % 19;
  b int := p_year / 100;
  c int := p_year % 100;
  h int;
  l int;
  m int;
begin
  h := (19 * a + b - b / 4 - (b - (b + 8) / 25 + 1) / 3 + 15) % 30;
  l := (32 + 2 * (b % 4) + 2 * (c / 4) - h - c % 4) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  return make_date(p_year, (h + l - 7 * m + 114) / 31, (h + l - 7 * m + 114) % 31 + 1);
end;
$$;

create or replace function private.is_business_day(p_date date)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_easter date := private.easter(extract(year from p_date)::int);
begin
  return extract(isodow from p_date) < 6
     and to_char(p_date, 'MM-DD') not in ('01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25')
     and p_date not in (v_easter - 48, v_easter - 47, v_easter - 2, v_easter + 60);
end;
$$;

-- N-ésimo dia útil do mês de p_month (ou o último dia útil, se o mês tiver menos).
create or replace function private.nth_business_day(p_month date, p_n int)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_day date := date_trunc('month', p_month)::date;
  v_last date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_count int := 0;
  v_found date;
begin
  while v_day <= v_last loop
    if private.is_business_day(v_day) then
      v_count := v_count + 1;
      v_found := v_day;
      if v_count = p_n then
        return v_day;
      end if;
    end if;
    v_day := v_day + 1;
  end loop;
  return v_found;
end;
$$;

grant execute on function private.easter(int), private.is_business_day(date), private.nth_business_day(date, int) to authenticated;

alter table public.financial_recurrences
  add column due_rule text not null default 'dia_fixo' check (due_rule in ('dia_fixo', 'dia_util')),
  add column business_day smallint check (business_day between 1 and 23),
  add constraint financial_recurrences_due_rule_ck check (due_rule = 'dia_fixo' or (business_day is not null and frequency <> 'semanal'));

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
  v_step interval;
begin
  for v_rec in
    select * from public.financial_recurrences r
     where r.is_active and coalesce(r.generated_until, r.start_date - 1) < v_until
       and private.fin_can(r.scope, r.owner_user_id, 'create')
  loop
    v_anchor := extract(day from v_rec.start_date)::int;
    v_step := case v_rec.frequency when 'trimestral' then interval '3 months' when 'semestral' then interval '6 months' when 'anual' then interval '12 months' else interval '1 month' end;
    if v_rec.due_rule = 'dia_util' then
      if v_rec.generated_until is null then
        v_date := private.nth_business_day(v_rec.start_date, v_rec.business_day);
        -- O dia útil do mês inicial já passou da data de início: começa no período seguinte.
        if v_date < v_rec.start_date then
          v_date := private.nth_business_day((date_trunc('month', v_rec.start_date) + v_step)::date, v_rec.business_day);
        end if;
      else
        v_date := private.nth_business_day((date_trunc('month', v_rec.generated_until) + v_step)::date, v_rec.business_day);
      end if;
    else
      v_date := case when v_rec.generated_until is null then v_rec.start_date else private.next_date(v_rec.generated_until, v_rec.frequency, v_anchor) end;
    end if;

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
      v_date := case
        when v_rec.due_rule = 'dia_util' then private.nth_business_day((date_trunc('month', v_date) + v_step)::date, v_rec.business_day)
        else private.next_date(v_date, v_rec.frequency, v_anchor)
      end;
    end loop;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.generate_recurrences(date) to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261102100000', 'finance_business_day') on conflict do nothing;

commit;
