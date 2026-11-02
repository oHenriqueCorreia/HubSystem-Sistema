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

commit;
