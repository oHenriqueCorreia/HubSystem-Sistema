-- =============================================================================
-- Anúncios: clientes de anúncio ligados aos clientes do sistema + escopo
-- =============================================================================
-- * ad_clients.client_id liga o grupo de contas ao cliente do sistema.
-- * ads.read / ads.manage com escopo "todos": tudo como antes (papéis padrão).
-- * Escopo menor (ex.: gestor de tráfego): só as contas, campanhas, métricas e
--   UTMs dos clientes em que a pessoa trabalha (Equipe do cliente ou squad).
-- * ad_report_crm (roda como dona) passa a filtrar as contas da mesma forma.
-- Desempenho: o teste de escopo "todos" é avaliado uma vez por consulta.
-- =============================================================================

alter table public.ad_clients add column client_id uuid references public.clients (id) on delete set null;
create unique index ad_clients_client_uq on public.ad_clients (client_id) where client_id is not null;

create or replace function private.is_ad_client_member(p_ad_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ad_clients ac
    where ac.id = p_ad_client and ac.organization_id = private.org_id() and private.is_client_member(ac.client_id)
  );
$$;

create or replace function private.is_ad_account_member(p_account uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ad_accounts a
    join public.ad_clients ac on ac.id = a.ad_client_id
    where a.id = p_account and a.organization_id = private.org_id() and private.is_client_member(ac.client_id)
  );
$$;

revoke execute on function private.is_ad_client_member(uuid), private.is_ad_account_member(uuid) from public, anon;
grant execute on function private.is_ad_client_member(uuid), private.is_ad_account_member(uuid) to authenticated, service_role;

-- O cliente do sistema precisa ser da mesma empresa.
create or replace function private.ad_clients_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_id is not null
     and not exists (select 1 from public.clients where id = new.client_id and organization_id = new.organization_id) then
    raise exception 'Cliente de outra empresa.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger ad_clients_guard before insert or update of client_id on public.ad_clients
  for each row execute function private.ad_clients_guard();

-- -----------------------------------------------------------------------------
-- Leitura
-- -----------------------------------------------------------------------------
drop policy ad_accounts_select on public.ad_accounts;
create policy ad_accounts_select on public.ad_accounts for select to authenticated
  using (organization_id = (select private.org_id())
         and ((select private.perm_scope('ads.read')) = 'all'
              or ((select private.has_perm('ads.read')) and private.is_ad_account_member(id))));

drop policy ad_campaigns_select on public.ad_campaigns;
create policy ad_campaigns_select on public.ad_campaigns for select to authenticated
  using (organization_id = (select private.org_id())
         and ((select private.perm_scope('ads.read')) = 'all'
              or ((select private.has_perm('ads.read')) and private.is_ad_account_member(account_id))));

drop policy ad_sets_select on public.ad_sets;
create policy ad_sets_select on public.ad_sets for select to authenticated
  using (organization_id = (select private.org_id())
         and ((select private.perm_scope('ads.read')) = 'all'
              or ((select private.has_perm('ads.read')) and private.is_ad_account_member(account_id))));

drop policy ads_select on public.ads;
create policy ads_select on public.ads for select to authenticated
  using (organization_id = (select private.org_id())
         and ((select private.perm_scope('ads.read')) = 'all'
              or ((select private.has_perm('ads.read')) and private.is_ad_account_member(account_id))));

drop policy ad_insights_select on public.ad_insights_daily;
create policy ad_insights_select on public.ad_insights_daily for select to authenticated
  using (organization_id = (select private.org_id())
         and ((select private.perm_scope('ads.read')) = 'all'
              or ((select private.has_perm('ads.read')) and private.is_ad_account_member(account_id))));

drop policy ad_insights_ad_select on public.ad_insights_ad_daily;
create policy ad_insights_ad_select on public.ad_insights_ad_daily for select to authenticated
  using (organization_id = (select private.org_id())
         and ((select private.perm_scope('ads.read')) = 'all'
              or ((select private.has_perm('ads.read')) and private.is_ad_account_member(account_id))));

drop policy ad_clients_select on public.ad_clients;
create policy ad_clients_select on public.ad_clients for select to authenticated
  using (organization_id = (select private.org_id())
         and ((select private.perm_scope('ads.read')) = 'all'
              or ((select private.has_perm('ads.read')) and private.is_client_member(client_id))));

drop policy utm_links_select on public.utm_links;
create policy utm_links_select on public.utm_links for select to authenticated
  using (organization_id = (select private.org_id())
         and ((select private.perm_scope('ads.read')) = 'all'
              or ((select private.has_perm('ads.read')) and private.is_ad_client_member(ad_client_id))));

-- -----------------------------------------------------------------------------
-- Escrita (ads.manage)
-- -----------------------------------------------------------------------------
drop policy ad_accounts_update on public.ad_accounts;
create policy ad_accounts_update on public.ad_accounts for update to authenticated
  using (organization_id = (select private.org_id()) and ((select private.perm_scope('ads.manage')) = 'all'
              or ((select private.has_perm('ads.manage')) and private.is_ad_account_member(id))))
  with check (organization_id = (select private.org_id()) and ((select private.perm_scope('ads.manage')) = 'all'
              or ((select private.has_perm('ads.manage')) and (ad_client_id is null or private.is_ad_client_member(ad_client_id)))));

drop policy ad_clients_write on public.ad_clients;
create policy ad_clients_write on public.ad_clients for all to authenticated
  using (organization_id = (select private.org_id()) and ((select private.perm_scope('ads.manage')) = 'all'
              or ((select private.has_perm('ads.manage')) and private.is_client_member(client_id))))
  with check (organization_id = (select private.org_id()) and ((select private.perm_scope('ads.manage')) = 'all'
              or ((select private.has_perm('ads.manage')) and private.is_client_member(client_id))));

drop policy utm_links_write on public.utm_links;
create policy utm_links_write on public.utm_links for all to authenticated
  using (organization_id = (select private.org_id()) and ((select private.perm_scope('ads.manage')) = 'all'
              or ((select private.has_perm('ads.manage')) and private.is_ad_client_member(ad_client_id))))
  with check (organization_id = (select private.org_id()) and ((select private.perm_scope('ads.manage')) = 'all'
              or ((select private.has_perm('ads.manage')) and private.is_ad_client_member(ad_client_id))));

-- -----------------------------------------------------------------------------
-- Relatório de CRM por anúncio (roda como dona)
-- -----------------------------------------------------------------------------
create or replace function public.ad_report_crm(p_accounts uuid[], p_from date, p_to date, p_statuses text[] default null)
returns table (ad_id uuid, campaign_id uuid, conversations bigint, leads bigint, won bigint, won_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with first_touch as (
    select distinct on (r.conversation_id) r.conversation_id, r.source_id, r.created_at
      from public.ad_referrals r
     where r.organization_id = (select private.org_id())
       and r.source_type = 'ad' and r.source_id is not null
     order by r.conversation_id, r.created_at
  ),
  touch as (
    select a.id as ad_id, a.campaign_id, ft.conversation_id, l.id as lead_id, ft.created_at
      from first_touch ft
      join public.ads a on a.external_id = ft.source_id and a.organization_id = (select private.org_id()) and a.account_id = any (p_accounts)
                       -- Só contas que a pessoa enxerga (escopo e clientes associados).
                       and ((select private.perm_scope('ads.read')) = 'all' or private.is_ad_account_member(a.account_id))
      join public.ad_campaigns c on c.id = a.campaign_id
      join public.conversations cv on cv.id = ft.conversation_id
      left join public.leads l on l.id = cv.lead_id and l.deleted_at is null
     where (select private.has_perm('ads.read'))
       and (ft.created_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
       and (p_statuses is null or c.status = any (p_statuses))
  ),
  per_ad as (
    select t.ad_id, t.campaign_id, count(*)::bigint as conversations, count(distinct t.lead_id)::bigint as leads
      from touch t
     group by t.ad_id, t.campaign_id
  ),
  -- Um lead pertence ao primeiro anúncio que o trouxe; contam as vendas ganhas depois desse contato.
  lead_ad as (
    select distinct on (t.lead_id) t.lead_id, t.ad_id, t.created_at
      from touch t
     where t.lead_id is not null
     order by t.lead_id, t.created_at
  ),
  won as (
    select la.ad_id, count(d.id)::bigint as won, coalesce(sum(d.amount_cents), 0)::bigint as won_cents
      from lead_ad la
      join public.deals d on d.lead_id = la.lead_id and d.won_at is not null and d.won_at >= la.created_at and d.deleted_at is null
     group by la.ad_id
  )
  select p.ad_id, p.campaign_id, p.conversations, p.leads, coalesce(w.won, 0)::bigint, coalesce(w.won_cents, 0)::bigint
    from per_ad p
    left join won w on w.ad_id = p.ad_id;
$$;
