import "server-only";
import { createClient } from "@/lib/supabase/server";

export type AdAccount = {
  id: string;
  provider: "meta_ads" | "google_ads";
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

export type AdConnection = { provider: "meta_ads" | "google_ads"; external_user: string; status: string; last_synced_at: string | null; last_error: string | null; expires_at: string | null };

export async function getAdsSetup() {
  const supabase = await createClient();
  const [conns, accounts] = await Promise.all([
    supabase.rpc("my_ad_connections"),
    supabase.from("ad_accounts").select("*").order("provider").order("name"),
  ]);
  if (accounts.error) throw accounts.error;
  return { connections: (conns.data ?? []) as AdConnection[], accounts: (accounts.data ?? []) as AdAccount[] };
}

export type Totals = { impressions: number; reach: number; clicks: number; spend: number; conversions: number };
const empty = (): Totals => ({ impressions: 0, reach: 0, clicks: 0, spend: 0, conversions: 0 });

export type ReportFilters = { from: string; to: string; prevFrom: string; prevTo: string; accountId?: string; status?: string; group: "dia" | "semana" | "mes" };

type Insight = { day: string; impressions: number; reach: number | null; clicks: number; spend_cents: number; conversions: number | null; campaign_id: string | null; account_id: string };

function bucket(day: string, group: ReportFilters["group"]) {
  if (group === "mes") return day.slice(0, 7);
  if (group === "semana") {
    // Semana começando no domingo (padrão da agenda).
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.toISOString().slice(0, 10);
  }
  return day;
}

function add(t: Totals, r: Insight) {
  t.impressions += Number(r.impressions);
  t.reach += Number(r.reach ?? 0);
  t.clicks += Number(r.clicks);
  t.spend += Number(r.spend_cents);
  t.conversions += Number(r.conversions ?? 0);
}

/** Relatório do período (contas selecionadas), com período anterior para comparação. */
export async function getAdsReport(accounts: AdAccount[], f: ReportFilters) {
  const supabase = await createClient();
  const ids = accounts.filter((a) => a.is_selected && (!f.accountId || a.id === f.accountId)).map((a) => a.id);
  if (!ids.length) return null;

  const campaignsQ = supabase.from("ad_campaigns").select("id, account_id, name, status, objective, daily_budget_cents, lifetime_budget_cents").in("account_id", ids);
  const [campaignsRes, curRes, prevRes] = await Promise.all([
    f.status ? campaignsQ.eq("status", f.status) : campaignsQ,
    supabase.from("ad_insights_daily").select("day, impressions, reach, clicks, spend_cents, conversions, campaign_id, account_id").in("account_id", ids).gte("day", f.from).lte("day", f.to).limit(50000),
    supabase.from("ad_insights_daily").select("day, impressions, reach, clicks, spend_cents, conversions, campaign_id, account_id").in("account_id", ids).gte("day", f.prevFrom).lte("day", f.prevTo).limit(50000),
  ]);
  for (const r of [campaignsRes, curRes, prevRes]) if (r.error) throw r.error;

  const campaigns = campaignsRes.data ?? [];
  const allowed = new Set(campaigns.map((c) => c.id));
  const keep = (r: Insight) => !f.status || (r.campaign_id !== null && allowed.has(r.campaign_id));
  const cur = ((curRes.data ?? []) as Insight[]).filter(keep);
  const prev = ((prevRes.data ?? []) as Insight[]).filter(keep);

  const totals = empty();
  const previous = empty();
  cur.forEach((r) => add(totals, r));
  prev.forEach((r) => add(previous, r));

  const series = new Map<string, Totals>();
  for (const r of cur) {
    const k = bucket(r.day, f.group);
    if (!series.has(k)) series.set(k, empty());
    add(series.get(k)!, r);
  }

  const byCampaign = new Map<string, Totals>();
  for (const r of cur) {
    if (!r.campaign_id) continue;
    if (!byCampaign.has(r.campaign_id)) byCampaign.set(r.campaign_id, empty());
    add(byCampaign.get(r.campaign_id)!, r);
  }
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));

  return {
    totals,
    previous,
    series: [...series.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, t]) => ({ period, ...t })),
    campaigns: campaigns
      .map((c) => ({ ...c, account: accountName.get(c.account_id) ?? "", metrics: byCampaign.get(c.id) ?? empty() }))
      .sort((a, b) => b.metrics.spend - a.metrics.spend),
  };
}

export const ratio = (num: number, den: number) => (den > 0 ? num / den : null);
