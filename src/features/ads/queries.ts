import "server-only";
import { createClient } from "@/lib/supabase/server";
import { STATUS_GROUPS, type AdsFilters, type Provider } from "./filters";

export type AdAccount = {
  id: string;
  provider: Provider;
  external_id: string;
  name: string;
  currency: string;
  status: string | null;
  is_selected: boolean;
  balance_cents: number | null;
  spend_cap_cents: number | null;
  amount_spent_cents: number | null;
  alert_balance_below_cents: number | null;
  alert_daily_spend_above_cents: number | null;
  last_synced_at: string | null;
};

export type AdConnection = { provider: Provider; external_user: string; status: string; last_synced_at: string | null; last_error: string | null; expires_at: string | null };

export async function getAdsSetup() {
  const supabase = await createClient();
  const [conns, accounts] = await Promise.all([
    supabase.rpc("my_ad_connections"),
    supabase.from("ad_accounts").select("*").order("provider").order("name"),
  ]);
  if (accounts.error) throw accounts.error;
  return { connections: (conns.data ?? []) as AdConnection[], accounts: (accounts.data ?? []) as AdAccount[] };
}

/** Contas que entram no relatório com os filtros atuais. */
export const reportAccounts = (accounts: AdAccount[], f: AdsFilters) =>
  accounts.filter((a) => a.is_selected && (!f.accountId || a.id === f.accountId) && (!f.provider || a.provider === f.provider));

export type Totals = { impressions: number; reach: number; clicks: number; spend: number; conversions: number; conversionValue: number };
export const emptyTotals = (): Totals => ({ impressions: 0, reach: 0, clicks: 0, spend: 0, conversions: 0, conversionValue: 0 });

type AggRow = { impressions: number | string; reach: number | string; clicks: number | string; spend_cents: number | string; conversions: number | string; conversion_value_cents: number | string };

function addRow(t: Totals, r: AggRow) {
  t.impressions += Number(r.impressions);
  t.reach += Number(r.reach);
  t.clicks += Number(r.clicks);
  t.spend += Number(r.spend_cents);
  t.conversions += Number(r.conversions);
  t.conversionValue += Number(r.conversion_value_cents);
  return t;
}

function sumInto<T extends Record<string, number>>(t: T, o: T) {
  for (const k of Object.keys(t) as (keyof T)[]) t[k] = (t[k] + o[k]) as T[keyof T];
  return t;
}

export const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

/** Do anúncio à venda: conversas de "Clique para WhatsApp", leads e negócios ganhos (valores do CRM). */
export type CrmTotals = { conversations: number; leads: number; won: number; wonValue: number };
export const emptyCrm = (): CrmTotals => ({ conversations: 0, leads: 0, won: 0, wonValue: 0 });

type CrmRow = { ad_id: string; campaign_id: string; conversations: number | string; leads: number | string; won: number | string; won_cents: number | string };

function addCrm(t: CrmTotals, r: CrmRow) {
  t.conversations += Number(r.conversations);
  t.leads += Number(r.leads);
  t.won += Number(r.won);
  t.wonValue += Number(r.won_cents);
  return t;
}

function crmBy(rows: CrmRow[], key: "ad_id" | "campaign_id") {
  const map = new Map<string, CrmTotals>();
  for (const r of rows) map.set(r[key], addCrm(map.get(r[key]) ?? emptyCrm(), r));
  return map;
}

// Dado complementar: se a consulta falhar, o relatório de mídia continua de pé.
async function crmRows(ids: string[], from: string, to: string, statuses: string[] | null = null) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ad_report_crm", { p_accounts: ids, p_from: from, p_to: to, p_statuses: statuses });
  if (error) {
    console.error("[ads] falha ao ler conversas e vendas dos anúncios", error.code);
    return [] as CrmRow[];
  }
  return (data ?? []) as CrmRow[];
}

type SeriesRow = AggRow & { bucket: string; provider: Provider };

async function series(ids: string[], from: string, to: string, f: AdsFilters, campaignId?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ad_report_series", {
    p_accounts: ids,
    p_from: from,
    p_to: to,
    p_group: f.group,
    p_statuses: f.status ? STATUS_GROUPS[f.status] : null,
    p_campaign: campaignId ?? null,
  });
  if (error) throw error;
  return (data ?? []) as SeriesRow[];
}

function summarize(rows: SeriesRow[]) {
  const total = emptyTotals();
  const byProvider: Record<Provider, Totals> = { meta_ads: emptyTotals(), google_ads: emptyTotals() };
  for (const r of rows) {
    addRow(total, r);
    addRow(byProvider[r.provider], r);
  }
  return { total, byProvider };
}

export type SeriesPoint = Totals & { period: string; meta_spend: number; google_spend: number };

/** Visão geral: totais, comparação com o período anterior, série e divisão por plataforma. */
export async function getAdsOverview(accounts: AdAccount[], f: AdsFilters, campaignId?: string) {
  const ids = reportAccounts(accounts, f).map((a) => a.id);
  if (!ids.length) return null;
  const statuses = f.status ? STATUS_GROUPS[f.status] : null;
  const [cur, prev, crmCur, crmPrev] = await Promise.all([
    series(ids, f.from, f.to, f, campaignId),
    series(ids, f.prevFrom, f.prevTo, f, campaignId),
    crmRows(ids, f.from, f.to, statuses),
    crmRows(ids, f.prevFrom, f.prevTo, statuses),
  ]);
  const crmTotal = (rows: CrmRow[]) => rows.filter((r) => !campaignId || r.campaign_id === campaignId).reduce(addCrm, emptyCrm());

  const points = new Map<string, SeriesPoint>();
  for (const r of cur) {
    if (!points.has(r.bucket)) points.set(r.bucket, { period: r.bucket, ...emptyTotals(), meta_spend: 0, google_spend: 0 });
    const p = points.get(r.bucket)!;
    addRow(p, r);
    if (r.provider === "meta_ads") p.meta_spend += Number(r.spend_cents);
    else p.google_spend += Number(r.spend_cents);
  }
  const now = summarize(cur);
  const before = summarize(prev);
  return {
    totals: now.total,
    previous: before.total,
    byProvider: now.byProvider,
    previousByProvider: before.byProvider,
    series: [...points.values()].sort((a, b) => a.period.localeCompare(b.period)),
    crm: crmTotal(crmCur),
    previousCrm: crmTotal(crmPrev),
  };
}

export type CampaignRow = {
  id: string;
  account_id: string;
  name: string;
  status: string | null;
  objective: string | null;
  daily_budget_cents: number | null;
  lifetime_budget_cents: number | null;
  account: string;
  provider: Provider;
  metrics: Totals;
  crm: CrmTotals;
};

/** Campanhas das contas do relatório, com métricas do período, por investimento. */
export async function getCampaignsReport(accounts: AdAccount[], f: AdsFilters) {
  const scoped = reportAccounts(accounts, f);
  const ids = scoped.map((a) => a.id);
  if (!ids.length) return [];
  const supabase = await createClient();
  const q = supabase.from("ad_campaigns").select("id, account_id, name, status, objective, daily_budget_cents, lifetime_budget_cents").in("account_id", ids);
  const [campaigns, metrics, crm] = await Promise.all([
    f.status ? q.in("status", STATUS_GROUPS[f.status]) : q,
    supabase.rpc("ad_report_campaigns", { p_accounts: ids, p_from: f.from, p_to: f.to }),
    crmRows(ids, f.from, f.to),
  ]);
  if (campaigns.error) throw campaigns.error;
  if (metrics.error) throw metrics.error;

  const byId = new Map(((metrics.data ?? []) as (AggRow & { campaign_id: string })[]).map((m) => [m.campaign_id, addRow(emptyTotals(), m)]));
  const crmById = crmBy(crm, "campaign_id");
  const acc = new Map(scoped.map((a) => [a.id, a]));
  return (campaigns.data ?? [])
    .map(
      (c) =>
        ({
          ...c,
          account: acc.get(c.account_id)?.name ?? "",
          provider: acc.get(c.account_id)!.provider,
          metrics: byId.get(c.id) ?? emptyTotals(),
          crm: crmById.get(c.id) ?? emptyCrm(),
        }) as CampaignRow,
    )
    .sort((a, b) => b.metrics.spend - a.metrics.spend || a.name.localeCompare(b.name));
}

export type AdRow = {
  id: string;
  account_id: string;
  campaign_id: string;
  ad_set_id: string | null;
  name: string;
  status: string | null;
  format: string | null;
  headline: string | null;
  body: string | null;
  image_url: string | null;
  link_url: string | null;
  campaign: string;
  account: string;
  provider: Provider;
  metrics: Totals;
  crm: CrmTotals;
};

export type AdSetRow = {
  id: string;
  account_id: string;
  campaign_id: string;
  name: string;
  status: string | null;
  optimization_goal: string | null;
  daily_budget_cents: number | null;
  campaign: string;
  account: string;
  provider: Provider;
  ads: number;
  metrics: Totals;
  crm: CrmTotals;
};

/**
 * Conjuntos/grupos e anúncios com métricas do período. As métricas de um
 * conjunto são a soma dos seus anúncios. `campaignId` restringe a uma campanha.
 */
export async function getAdLevelReport(accounts: AdAccount[], f: AdsFilters, campaignId?: string) {
  const scoped = reportAccounts(accounts, f);
  const ids = scoped.map((a) => a.id);
  if (!ids.length) return { adSets: [] as AdSetRow[], ads: [] as AdRow[] };
  const supabase = await createClient();

  let setsQ = supabase.from("ad_sets").select("id, account_id, campaign_id, name, status, optimization_goal, daily_budget_cents, ad_campaigns(name)").in("account_id", ids);
  let adsQ = supabase.from("ads").select("id, account_id, campaign_id, ad_set_id, name, status, format, headline, body, image_url, link_url, ad_campaigns(name)").in("account_id", ids);
  if (campaignId) {
    setsQ = setsQ.eq("campaign_id", campaignId);
    adsQ = adsQ.eq("campaign_id", campaignId);
  }
  const [sets, ads, metrics, crm] = await Promise.all([setsQ, adsQ, supabase.rpc("ad_report_ads", { p_accounts: ids, p_from: f.from, p_to: f.to }), crmRows(ids, f.from, f.to)]);
  for (const r of [sets, ads, metrics]) if (r.error) throw r.error;

  const byAd = new Map(((metrics.data ?? []) as (AggRow & { ad_id: string })[]).map((m) => [m.ad_id, addRow(emptyTotals(), m)]));
  const crmByAd = crmBy(crm, "ad_id");
  const acc = new Map(scoped.map((a) => [a.id, a]));
  const campaignName = (r: { ad_campaigns: unknown }) => (r.ad_campaigns as { name: string } | null)?.name ?? "";
  const statuses = f.status ? new Set(STATUS_GROUPS[f.status]) : null;

  const allAds: AdRow[] = ((ads.data ?? []) as (Omit<AdRow, "campaign" | "account" | "provider" | "metrics" | "crm"> & { ad_campaigns: unknown })[]).map(({ ad_campaigns, ...a }) => ({
    ...a,
    campaign: campaignName({ ad_campaigns }),
    account: acc.get(a.account_id)?.name ?? "",
    provider: acc.get(a.account_id)!.provider,
    metrics: byAd.get(a.id) ?? emptyTotals(),
    crm: crmByAd.get(a.id) ?? emptyCrm(),
  }));

  const perSet = new Map<string, { n: number; t: Totals; crm: CrmTotals }>();
  for (const a of allAds) {
    if (!a.ad_set_id) continue;
    if (!perSet.has(a.ad_set_id)) perSet.set(a.ad_set_id, { n: 0, t: emptyTotals(), crm: emptyCrm() });
    const s = perSet.get(a.ad_set_id)!;
    s.n++;
    sumInto(s.t, a.metrics);
    sumInto(s.crm, a.crm);
  }

  const adSets: AdSetRow[] = ((sets.data ?? []) as (Omit<AdSetRow, "campaign" | "account" | "provider" | "ads" | "metrics" | "crm"> & { ad_campaigns: unknown })[])
    .filter((s) => !statuses || statuses.has(s.status ?? ""))
    .map(({ ad_campaigns, ...s }) => ({
      ...s,
      campaign: campaignName({ ad_campaigns }),
      account: acc.get(s.account_id)?.name ?? "",
      provider: acc.get(s.account_id)!.provider,
      ads: perSet.get(s.id)?.n ?? 0,
      metrics: perSet.get(s.id)?.t ?? emptyTotals(),
      crm: perSet.get(s.id)?.crm ?? emptyCrm(),
    }))
    .sort((a, b) => b.metrics.spend - a.metrics.spend || a.name.localeCompare(b.name));

  return {
    adSets,
    ads: allAds.filter((a) => !statuses || statuses.has(a.status ?? "")).sort((a, b) => b.metrics.spend - a.metrics.spend || a.name.localeCompare(b.name)),
  };
}

/** Uma campanha (RLS garante a organização e a permissão). */
export async function getCampaign(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ad_campaigns")
    .select("id, account_id, external_id, name, status, objective, daily_budget_cents, lifetime_budget_cents, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as {
    id: string;
    account_id: string;
    external_id: string;
    name: string;
    status: string | null;
    objective: string | null;
    daily_budget_cents: number | null;
    lifetime_budget_cents: number | null;
    updated_at: string;
  } | null;
}
