import "server-only";
import { publicEnv } from "@/lib/env";

// Marketing API oficial da Meta (Graph API). Somente leitura de anúncios.
export const META_SCOPES = ["ads_read", "business_management"];
const version = () => process.env.META_GRAPH_VERSION || "v23.0";
const graph = (path: string) => `https://graph.facebook.com/${version()}${path}`;

export const metaConfigured = () => Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.TOKEN_ENCRYPTION_KEY && process.env.SUPABASE_SECRET_KEY);
export const metaRedirectUri = () => `${publicEnv.NEXT_PUBLIC_SITE_URL}/api/ads/meta/callback`;

export function metaAuthUrl(state: string) {
  const q = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    redirect_uri: metaRedirectUri(),
    state,
    scope: META_SCOPES.join(","),
    response_type: "code",
  });
  return `https://www.facebook.com/${version()}/dialog/oauth?${q.toString()}`;
}

type GraphError = { error?: { message: string; code: number; error_subcode?: number } };

async function get<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
    const data = (await res.json().catch(() => ({}))) as T & GraphError;
    // Limite de chamadas (códigos 4, 17, 32, 613): espera e tenta de novo, no máximo 2 vezes.
    if (data.error && [4, 17, 32, 613].includes(data.error.code) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      continue;
    }
    if (!res.ok || data.error) throw Object.assign(new Error("meta_api"), { code: data.error?.code, subcode: data.error?.error_subcode });
    return data;
  }
}

/** Código → token de longa duração (cerca de 60 dias). */
export async function metaExchangeCode(code: string) {
  const base = { client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET! };
  const short = await get<{ access_token: string }>(graph(`/oauth/access_token?${new URLSearchParams({ ...base, redirect_uri: metaRedirectUri(), code })}`));
  const long = await get<{ access_token: string; expires_in?: number }>(
    graph(`/oauth/access_token?${new URLSearchParams({ ...base, grant_type: "fb_exchange_token", fb_exchange_token: short.access_token })}`),
  );
  const me = await get<{ name?: string; id: string }>(graph(`/me?fields=id,name&access_token=${encodeURIComponent(long.access_token)}`));
  return { token: long.access_token, expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null, user: me.name ?? me.id };
}

export async function metaRevoke(token: string) {
  await fetch(graph(`/me/permissions?access_token=${encodeURIComponent(token)}`), { method: "DELETE", cache: "no-store" }).catch(() => null);
}

type Paged<T> = { data: T[]; paging?: { next?: string } };
async function all<T>(url: string, max = 2000): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = url;
  while (next && out.length < max) {
    const page: Paged<T> = await get<Paged<T>>(next);
    out.push(...page.data);
    next = page.paging?.next;
  }
  return out;
}

// Valores monetários da Marketing API vêm em centavos da moeda da conta (string).
const cents = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Math.round(Number(v)));

export type MetaAccount = { externalId: string; name: string; currency: string; status: string; balanceCents: number | null; spendCapCents: number | null; amountSpentCents: number | null };

const ACCOUNT_STATUS: Record<number, string> = { 1: "Ativa", 2: "Desativada", 3: "Pendente de pagamento", 7: "Em análise", 8: "Pagamento pendente", 9: "Em período de carência", 100: "Encerramento pendente", 101: "Encerrada" };

export async function metaAccounts(token: string): Promise<MetaAccount[]> {
  const rows = await all<{ id: string; name: string; currency: string; account_status: number; balance?: string; spend_cap?: string; amount_spent?: string }>(
    graph(`/me/adaccounts?fields=id,name,currency,account_status,balance,spend_cap,amount_spent&limit=100&access_token=${encodeURIComponent(token)}`),
  );
  return rows.map((a) => ({
    externalId: a.id,
    name: a.name,
    currency: a.currency,
    status: ACCOUNT_STATUS[a.account_status] ?? String(a.account_status),
    balanceCents: cents(a.balance),
    // spend_cap "0" significa "sem limite definido".
    spendCapCents: a.spend_cap && a.spend_cap !== "0" ? cents(a.spend_cap) : null,
    amountSpentCents: cents(a.amount_spent),
  }));
}

export type MetaCampaign = { externalId: string; name: string; status: string; objective: string | null; dailyBudgetCents: number | null; lifetimeBudgetCents: number | null };

export async function metaCampaigns(token: string, accountId: string): Promise<MetaCampaign[]> {
  const rows = await all<{ id: string; name: string; effective_status: string; objective?: string; daily_budget?: string; lifetime_budget?: string }>(
    graph(`/${accountId}/campaigns?fields=id,name,effective_status,objective,daily_budget,lifetime_budget&limit=200&access_token=${encodeURIComponent(token)}`),
  );
  return rows.map((c) => ({
    externalId: c.id,
    name: c.name,
    status: c.effective_status,
    objective: c.objective ?? null,
    dailyBudgetCents: cents(c.daily_budget),
    lifetimeBudgetCents: cents(c.lifetime_budget),
  }));
}

export type DailyMetric = { campaignExternalId: string; day: string; impressions: number; reach: number | null; clicks: number; spendCents: number; conversions: number | null };

const CONVERSION_ACTIONS = new Set(["offsite_conversion.fb_pixel_purchase", "purchase", "lead", "onsite_conversion.lead_grouped", "complete_registration", "onsite_conversion.messaging_conversation_started_7d"]);

export async function metaDailyInsights(token: string, accountId: string, since: string, until: string): Promise<DailyMetric[]> {
  const q = new URLSearchParams({
    level: "campaign",
    fields: "campaign_id,impressions,reach,clicks,spend,actions",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    limit: "500",
    access_token: token,
  });
  const rows = await all<{ campaign_id: string; date_start: string; impressions?: string; reach?: string; clicks?: string; spend?: string; actions?: { action_type: string; value: string }[] }>(
    graph(`/${accountId}/insights?${q.toString()}`),
    20000,
  );
  return rows.map((r) => {
    const conv = r.actions?.filter((a) => CONVERSION_ACTIONS.has(a.action_type)).reduce((s, a) => s + Number(a.value), 0);
    return {
      campaignExternalId: r.campaign_id,
      day: r.date_start,
      impressions: Number(r.impressions ?? 0),
      reach: r.reach ? Number(r.reach) : null,
      clicks: Number(r.clicks ?? 0),
      // "spend" vem na moeda da conta como decimal (ex.: "12.34").
      spendCents: Math.round(Number(r.spend ?? 0) * 100),
      conversions: r.actions ? (conv ?? 0) : null,
    };
  });
}
