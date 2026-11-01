-- =============================================================================
-- Anúncios · estrutura completa (conjuntos/grupos, anúncios, criativos, ROAS)
-- =============================================================================
--   * ad_sets: conjuntos de anúncios (Meta) e grupos de anúncios (Google).
--   * ads: anúncios com o resumo do criativo (título, texto, miniatura, link).
--   * ad_insights_ad_daily: métricas diárias por anúncio. As métricas de
--     campanha continuam em ad_insights_daily (campanhas sem anúncios, como
--     Performance Max, só existem lá).
--   * conversion_value_cents: valor das conversões, para ROAS.
--   * Funções de relatório agregam no banco (security invoker → RLS vale),
--     evitando o limite de linhas por requisição da API.
-- =============================================================================

alter table public.ad_insights_daily add column conversion_value_cents bigint;

create table public.ad_sets (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  account_id          uuid not null references public.ad_accounts (id) on delete cascade,
  campaign_id         uuid not null references public.ad_campaigns (id) on delete cascade,
  external_id         text not null,
  name                text not null,
  status              text,
  optimization_goal   text,
  daily_budget_cents  bigint,
  updated_at          timestamptz not null default now(),
  unique (account_id, external_id)
);
create index ad_sets_campaign_idx on public.ad_sets (campaign_id);

create table public.ads (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  account_id       uuid not null references public.ad_accounts (id) on delete cascade,
  campaign_id      uuid not null references public.ad_campaigns (id) on delete cascade,
  ad_set_id        uuid references public.ad_sets (id) on delete cascade,
  external_id      text not null,
  name             text not null,
  status           text,
  format           text,
  headline         text check (char_length(headline) <= 500),
  body             text check (char_length(body) <= 2000),
  image_url        text check (image_url ~ '^https://'),
  link_url         text check (link_url ~ '^https?://'),
  updated_at       timestamptz not null default now(),
  unique (account_id, external_id)
);
create index ads_campaign_idx on public.ads (campaign_id);
create index ads_ad_set_idx on public.ads (ad_set_id);

create table public.ad_insights_ad_daily (
  id                      bigint generated always as identity primary key,
  organization_id         uuid not null references public.organizations (id) on delete cascade,
  account_id              uuid not null references public.ad_accounts (id) on delete cascade,
  ad_id                   uuid not null references public.ads (id) on delete cascade,
  day                     date not null,
  impressions             bigint not null default 0,
  reach                   bigint,
  clicks                  bigint not null default 0,
  spend_cents             bigint not null default 0,
  conversions             numeric(14, 2),
  conversion_value_cents  bigint,
  unique (ad_id, day)
);
create index ad_insights_ad_account_day_idx on public.ad_insights_ad_daily (account_id, day);

alter table public.ad_sets enable row level security;
alter table public.ads enable row level security;
alter table public.ad_insights_ad_daily enable row level security;

create policy ad_sets_select on public.ad_sets for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('ads.read')));
create policy ads_select on public.ads for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('ads.read')));
create policy ad_insights_ad_select on public.ad_insights_ad_daily for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('ads.read')));
-- Dados vindos das APIs: somente o servidor escreve.
revoke insert, update, delete on public.ad_sets, public.ads, public.ad_insights_ad_daily from authenticated;

-- -----------------------------------------------------------------------------
-- Relatórios agregados. security invoker: a RLS das tabelas continua valendo.
-- -----------------------------------------------------------------------------

-- Série por período (dia, semana começando no domingo ou mês) e plataforma.
create or replace function public.ad_report_series(p_accounts uuid[], p_from date, p_to date, p_group text default 'dia', p_statuses text[] default null, p_campaign uuid default null)
returns table (bucket text, provider text, impressions bigint, reach bigint, clicks bigint, spend_cents bigint, conversions numeric, conversion_value_cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    case p_group
      when 'mes' then to_char(i.day, 'YYYY-MM')
      when 'semana' then to_char(i.day - extract(dow from i.day)::int, 'YYYY-MM-DD')
      else to_char(i.day, 'YYYY-MM-DD')
    end,
    a.provider,
    sum(i.impressions)::bigint,
    sum(coalesce(i.reach, 0))::bigint,
    sum(i.clicks)::bigint,
    sum(i.spend_cents)::bigint,
    sum(coalesce(i.conversions, 0)),
    sum(coalesce(i.conversion_value_cents, 0))::bigint
  from public.ad_insights_daily i
  join public.ad_accounts a on a.id = i.account_id
  left join public.ad_campaigns c on c.id = i.campaign_id
  where i.account_id = any (p_accounts)
    and i.day between p_from and p_to
    and (p_statuses is null or c.status = any (p_statuses))
    and (p_campaign is null or i.campaign_id = p_campaign)
  group by 1, 2
  order by 1, 2;
$$;

-- Totais por campanha no período.
create or replace function public.ad_report_campaigns(p_accounts uuid[], p_from date, p_to date)
returns table (campaign_id uuid, impressions bigint, reach bigint, clicks bigint, spend_cents bigint, conversions numeric, conversion_value_cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.campaign_id, sum(i.impressions)::bigint, sum(coalesce(i.reach, 0))::bigint, sum(i.clicks)::bigint, sum(i.spend_cents)::bigint,
         sum(coalesce(i.conversions, 0)), sum(coalesce(i.conversion_value_cents, 0))::bigint
  from public.ad_insights_daily i
  where i.account_id = any (p_accounts) and i.day between p_from and p_to and i.campaign_id is not null
  group by i.campaign_id;
$$;

-- Totais por anúncio no período (conjuntos são a soma dos seus anúncios).
create or replace function public.ad_report_ads(p_accounts uuid[], p_from date, p_to date)
returns table (ad_id uuid, impressions bigint, reach bigint, clicks bigint, spend_cents bigint, conversions numeric, conversion_value_cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.ad_id, sum(i.impressions)::bigint, sum(coalesce(i.reach, 0))::bigint, sum(i.clicks)::bigint, sum(i.spend_cents)::bigint,
         sum(coalesce(i.conversions, 0)), sum(coalesce(i.conversion_value_cents, 0))::bigint
  from public.ad_insights_ad_daily i
  where i.account_id = any (p_accounts) and i.day between p_from and p_to
  group by i.ad_id;
$$;

revoke execute on function public.ad_report_series(uuid[], date, date, text, text[], uuid) from public, anon;
revoke execute on function public.ad_report_campaigns(uuid[], date, date) from public, anon;
revoke execute on function public.ad_report_ads(uuid[], date, date) from public, anon;
grant execute on function public.ad_report_series(uuid[], date, date, text, text[], uuid) to authenticated;
grant execute on function public.ad_report_campaigns(uuid[], date, date) to authenticated;
grant execute on function public.ad_report_ads(uuid[], date, date) to authenticated;
