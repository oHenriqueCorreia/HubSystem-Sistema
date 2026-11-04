import "server-only";
import { publicEnv } from "@/lib/env";

// Google Ads API oficial (REST). Somente leitura.
export const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";
const version = () => process.env.GOOGLE_ADS_API_VERSION || "v26";
const API = () => `https://googleads.googleapis.com/${version()}`;

// O acesso à API vem do projeto do Google Cloud dono do cliente OAuth: o Google aposentou o developer token em 09/2026.
export const googleAdsConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.TOKEN_ENCRYPTION_KEY && process.env.SUPABASE_SECRET_KEY);
const googleAdsRedirectUri = () => `${publicEnv.NEXT_PUBLIC_SITE_URL}/api/ads/google/callback`;

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

type MetricsRow = { segments: { date: string }; metrics: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number; conversionsValue?: number } };
const METRICS = "segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value";

function toMetric(r: MetricsRow) {
  return {
    day: r.segments.date,
    impressions: Number(r.metrics.impressions ?? 0),
    // O Google Ads não informa alcance por campanha/anúncio por dia.
    reach: null,
    clicks: Number(r.metrics.clicks ?? 0),
    spendCents: microsToCents(r.metrics.costMicros) ?? 0,
    conversions: r.metrics.conversions ?? 0,
    // conversions_value vem na moeda da conta (não em micros).
    conversionValueCents: Math.round(Number(r.metrics.conversionsValue ?? 0) * 100),
  };
}

export async function googleAdsDailyInsights(accessToken: string, customerId: string, since: string, until: string) {
  const rows = await search<MetricsRow & { campaign: { id: string } }>(
    accessToken,
    customerId,
    `SELECT campaign.id, ${METRICS} FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'`,
  );
  return rows.map((r) => ({ campaignExternalId: r.campaign.id, ...toMetric(r) }));
}

export async function googleAdsAdGroups(accessToken: string, customerId: string) {
  const rows = await search<{ adGroup: { id: string; name: string; status: string; type?: string }; campaign: { id: string } }>(
    accessToken,
    customerId,
    "SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type, campaign.id FROM ad_group WHERE ad_group.status != 'REMOVED'",
  );
  return rows.map((r) => ({
    externalId: r.adGroup.id,
    campaignExternalId: r.campaign.id,
    name: r.adGroup.name,
    status: r.adGroup.status,
    optimizationGoal: r.adGroup.type ?? null,
    // O orçamento no Google fica na campanha, não no grupo.
    dailyBudgetCents: null,
  }));
}

// O anúncio é identificado pelo par grupo~anúncio (como no próprio Google Ads).
const adKey = (adGroupId: string, adId: string) => `${adGroupId}~${adId}`;

type TextAsset = { text?: string };
type GoogleAd = {
  id: string;
  name?: string;
  type?: string;
  finalUrls?: string[];
  responsiveSearchAd?: { headlines?: TextAsset[]; descriptions?: TextAsset[] };
  responsiveDisplayAd?: { headlines?: TextAsset[]; longHeadline?: TextAsset; descriptions?: TextAsset[] };
  expandedTextAd?: { headlinePart1?: string; headlinePart2?: string; description?: string };
};

const AD_TYPE: Record<string, string> = { RESPONSIVE_SEARCH_AD: "Pesquisa responsivo", RESPONSIVE_DISPLAY_AD: "Display responsivo", EXPANDED_TEXT_AD: "Texto expandido", VIDEO_RESPONSIVE_AD: "Vídeo" };

export async function googleAdsAds(accessToken: string, customerId: string) {
  const rows = await search<{ adGroupAd: { status: string; ad: GoogleAd }; adGroup: { id: string }; campaign: { id: string } }>(
    accessToken,
    customerId,
    `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.ad.final_urls, ad_group_ad.status,
       ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions,
       ad_group_ad.ad.responsive_display_ad.headlines, ad_group_ad.ad.responsive_display_ad.long_headline, ad_group_ad.ad.responsive_display_ad.descriptions,
       ad_group_ad.ad.expanded_text_ad.headline_part1, ad_group_ad.ad.expanded_text_ad.headline_part2, ad_group_ad.ad.expanded_text_ad.description,
       ad_group.id, campaign.id
     FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'`,
  );
  const texts = (list?: TextAsset[]) => (list ?? []).map((t) => t.text).filter(Boolean) as string[];
  return rows.map((r) => {
    const ad = r.adGroupAd.ad;
    const headlines = [
      ...texts(ad.responsiveSearchAd?.headlines),
      ...texts(ad.responsiveDisplayAd?.longHeadline ? [ad.responsiveDisplayAd.longHeadline] : []),
      ...texts(ad.responsiveDisplayAd?.headlines),
      ...[ad.expandedTextAd?.headlinePart1, ad.expandedTextAd?.headlinePart2].filter(Boolean) as string[],
    ];
    const descriptions = [...texts(ad.responsiveSearchAd?.descriptions), ...texts(ad.responsiveDisplayAd?.descriptions), ...(ad.expandedTextAd?.description ? [ad.expandedTextAd.description] : [])];
    const url = ad.finalUrls?.[0];
    return {
      externalId: adKey(r.adGroup.id, ad.id),
      campaignExternalId: r.campaign.id,
      adSetExternalId: r.adGroup.id,
      name: ad.name || headlines[0] || `Anúncio ${ad.id}`,
      status: r.adGroupAd.status,
      format: ad.type ? (AD_TYPE[ad.type] ?? ad.type) : null,
      // Anúncios responsivos têm vários títulos; mostramos os três primeiros.
      headline: headlines.length ? headlines.slice(0, 3).join(" | ").slice(0, 500) : null,
      body: descriptions.length ? descriptions.slice(0, 2).join(" ").slice(0, 2000) : null,
      // A Google Ads API não entrega miniatura pronta do anúncio.
      imageUrl: null,
      linkUrl: url && /^https?:\/\//.test(url) ? url : null,
    };
  });
}

export async function googleAdsAdDailyInsights(accessToken: string, customerId: string, since: string, until: string) {
  const rows = await search<MetricsRow & { adGroupAd: { ad: { id: string } }; adGroup: { id: string } }>(
    accessToken,
    customerId,
    `SELECT ad_group_ad.ad.id, ad_group.id, ${METRICS} FROM ad_group_ad WHERE segments.date BETWEEN '${since}' AND '${until}'`,
  );
  return rows.map((r) => ({ adExternalId: adKey(r.adGroup.id, r.adGroupAd.ad.id), ...toMetric(r) }));
}
