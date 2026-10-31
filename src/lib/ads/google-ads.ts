import "server-only";
import { publicEnv } from "@/lib/env";

// Google Ads API oficial (REST). Somente leitura.
export const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";
const version = () => process.env.GOOGLE_ADS_API_VERSION || "v21";
const API = () => `https://googleads.googleapis.com/${version()}`;

export const googleAdsConfigured = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_ADS_DEVELOPER_TOKEN && process.env.TOKEN_ENCRYPTION_KEY && process.env.SUPABASE_SECRET_KEY);
export const googleAdsRedirectUri = () => `${publicEnv.NEXT_PUBLIC_SITE_URL}/api/ads/google/callback`;

export function googleAdsAuthUrl(state: string) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleAdsRedirectUri(),
    response_type: "code",
    scope: `openid email ${GOOGLE_ADS_SCOPE}`,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

async function token(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...body }),
    cache: "no-store",
  });
  const json = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string; id_token?: string; error?: string };
  if (!res.ok) throw Object.assign(new Error(json.error ?? "token_error"), { code: json.error });
  return json;
}

export async function googleAdsExchangeCode(code: string) {
  const t = await token({ code, grant_type: "authorization_code", redirect_uri: googleAdsRedirectUri() });
  const payload = t.id_token ? JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString("utf8")) : {};
  return { ...t, email: (payload.email as string | undefined) ?? "" };
}

export const googleAdsRefresh = (refreshToken: string) => token({ grant_type: "refresh_token", refresh_token: refreshToken });

function headers(accessToken: string, loginCustomerId?: string) {
  const h: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    "Content-Type": "application/json",
  };
  const login = (loginCustomerId ?? process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? "").replace(/\D/g, "");
  if (login) h["login-customer-id"] = login;
  return h;
}

async function call<T>(accessToken: string, path: string, init?: RequestInit, loginCustomerId?: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API()}${path}`, { ...init, headers: headers(accessToken, loginCustomerId), cache: "no-store", signal: AbortSignal.timeout(30000) });
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      continue;
    }
    const data = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) throw Object.assign(new Error("google_ads_api"), { status: res.status });
    return data;
  }
}

/** Contas às quais o usuário tem acesso (IDs "customers/123..."). */
export async function googleAdsAccessibleCustomers(accessToken: string): Promise<string[]> {
  const d = await call<{ resourceNames?: string[] }>(accessToken, "/customers:listAccessibleCustomers", { method: "GET" });
  return (d.resourceNames ?? []).map((r) => r.split("/")[1]);
}

async function search<T>(accessToken: string, customerId: string, query: string): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  for (let guard = 0; guard < 50; guard++) {
    const d = await call<{ results?: T[]; nextPageToken?: string }>(accessToken, `/customers/${customerId}/googleAds:search`, {
      method: "POST",
      body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
    });
    out.push(...(d.results ?? []));
    pageToken = d.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

export async function googleAdsCustomer(accessToken: string, customerId: string) {
  const rows = await search<{ customer: { descriptiveName?: string; currencyCode?: string; status?: string; manager?: boolean } }>(
    accessToken,
    customerId,
    "SELECT customer.descriptive_name, customer.currency_code, customer.status, customer.manager FROM customer LIMIT 1",
  );
  const c = rows[0]?.customer;
  return { name: c?.descriptiveName || `Conta ${customerId}`, currency: c?.currencyCode ?? "BRL", status: c?.status ?? null, manager: Boolean(c?.manager) };
}

// Valores monetários do Google Ads vêm em micros (1.000.000 = 1 unidade).
const microsToCents = (v: string | number | undefined) => (v === undefined ? null : Math.round(Number(v) / 10_000));

export async function googleAdsCampaigns(accessToken: string, customerId: string) {
  const rows = await search<{ campaign: { id: string; name: string; status: string; advertisingChannelType?: string }; campaignBudget?: { amountMicros?: string } }>(
    accessToken,
    customerId,
    "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED'",
  );
  return rows.map((r) => ({
    externalId: r.campaign.id,
    name: r.campaign.name,
    status: r.campaign.status,
    objective: r.campaign.advertisingChannelType ?? null,
    dailyBudgetCents: microsToCents(r.campaignBudget?.amountMicros),
    lifetimeBudgetCents: null,
  }));
}

export async function googleAdsDailyInsights(accessToken: string, customerId: string, since: string, until: string) {
  const rows = await search<{ campaign: { id: string }; segments: { date: string }; metrics: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number } }>(
    accessToken,
    customerId,
    `SELECT campaign.id, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'`,
  );
  return rows.map((r) => ({
    campaignExternalId: r.campaign.id,
    day: r.segments.date,
    impressions: Number(r.metrics.impressions ?? 0),
    // O Google Ads não informa alcance por campanha/dia nesta consulta.
    reach: null,
    clicks: Number(r.metrics.clicks ?? 0),
    spendCents: microsToCents(r.metrics.costMicros) ?? 0,
    conversions: r.metrics.conversions ?? 0,
  }));
}
