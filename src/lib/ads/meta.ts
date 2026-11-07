import "server-only";
import { publicEnv } from "@/lib/env";
import { sumConversionActions, type MetaAction } from "@/domain/ads/conversions";
import { parseFundingBalance } from "@/domain/ads/report-message";

// Marketing API oficial da Meta (Graph API): leitura e edição de anúncios.
export const META_SCOPES = ["ads_read", "ads_management", "business_management"];
const version = () => process.env.META_GRAPH_VERSION || "v23.0";
const graph = (path: string) => `https://graph.facebook.com/${version()}${path}`;

// Valores colados no painel da Vercel às vezes vêm com espaço, quebra de linha ou aspas.
const env = (name: string) => (process.env[name] ?? "").trim().replace(/^["']|["']$/g, "");
const appId = () => env("META_APP_ID");
const appSecret = () => env("META_APP_SECRET");

export const metaConfigured = () => Boolean(appId() && appSecret() && process.env.TOKEN_ENCRYPTION_KEY && process.env.SUPABASE_SECRET_KEY);
const metaRedirectUri = () => `${publicEnv.NEXT_PUBLIC_SITE_URL}/api/ads/meta/callback`;

export function metaAuthUrl(state: string) {
  const q = new URLSearchParams({
    client_id: appId(),
    redirect_uri: metaRedirectUri(),
    state,
    response_type: "code",
  });
  // Apps do tipo Empresa usam o "Login do Facebook para Empresas": as permissões e os ativos
  // vêm da configuração criada no painel da Meta (config_id) em vez do parâmetro scope.
  const configId = env("META_LOGIN_CONFIG_ID");
  if (configId) q.set("config_id", configId);
  else q.set("scope", META_SCOPES.join(","));
  return `https://www.facebook.com/${version()}/dialog/oauth?${q.toString()}`;
}

type GraphError = { error?: { message: string; type?: string; code: number; error_subcode?: number } };

async function get<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
    const data = (await res.json().catch(() => ({}))) as T & GraphError;
    // Limite de chamadas (códigos 4, 17, 32, 613): espera e tenta de novo, no máximo 2 vezes.
    if (data.error && [4, 17, 32, 613].includes(data.error.code) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      continue;
    }
    if (!res.ok || data.error)
      throw Object.assign(new Error("meta_api"), { code: data.error?.code, subcode: data.error?.error_subcode, detail: `${data.error?.type ?? res.status}: ${data.error?.message ?? ""}`.slice(0, 300) });
    return data;
  }
}

/** Código → token de longa duração (cerca de 60 dias). */
export async function metaExchangeCode(code: string) {
  const base = { client_id: appId(), client_secret: appSecret() };
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

export type MetaAccount = {
  externalId: string;
  name: string;
  currency: string;
  status: string;
  isPrepay: boolean | null;
  balanceCents: number | null;
  spendCapCents: number | null;
  amountSpentCents: number | null;
};

type MetaAccountRow = {
  id: string;
  name: string;
  currency: string;
  account_status: number;
  is_prepay_account?: boolean;
  balance?: string;
  spend_cap?: string;
  amount_spent?: string;
  funding_source_details?: { display_string?: string };
};

const ACCOUNT_FIELDS = "id,name,currency,account_status,is_prepay_account,balance,spend_cap,amount_spent,funding_source_details";

const ACCOUNT_STATUS: Record<number, string> = { 1: "Ativa", 2: "Desativada", 3: "Pendente de pagamento", 7: "Em análise", 8: "Pagamento pendente", 9: "Em período de carência", 100: "Encerramento pendente", 101: "Encerrada" };

function toAccount(a: MetaAccountRow): MetaAccount {
  const prepay = typeof a.is_prepay_account === "boolean" ? a.is_prepay_account : null;
  return {
    externalId: a.id,
    name: a.name,
    currency: a.currency,
    status: ACCOUNT_STATUS[a.account_status] ?? String(a.account_status),
    isPrepay: prepay,
    // Pré-paga: o saldo disponível vem no texto da forma de pagamento ("Saldo disponível (R$2,65 BRL)").
    // Pós-paga: "balance" é o valor ainda não cobrado.
    balanceCents: prepay ? (parseFundingBalance(a.funding_source_details?.display_string) ?? cents(a.balance)) : cents(a.balance),
    // spend_cap "0" significa "sem limite definido".
    spendCapCents: a.spend_cap && a.spend_cap !== "0" ? cents(a.spend_cap) : null,
    amountSpentCents: cents(a.amount_spent),
  };
}

export async function metaAccounts(token: string): Promise<MetaAccount[]> {
  const rows = await all<MetaAccountRow>(graph(`/me/adaccounts?fields=${ACCOUNT_FIELDS}&limit=100&access_token=${encodeURIComponent(token)}`));
  return rows.map(toAccount);
}

/** Uma conta, na hora: situação, saldo e gasto de hoje (para os alertas). */
export async function metaAccountLive(token: string, accountId: string) {
  const [acc, today] = await Promise.all([
    get<MetaAccountRow>(graph(`/${accountId}?fields=${ACCOUNT_FIELDS}&access_token=${encodeURIComponent(token)}`)),
    get<{ data?: { spend?: string }[] }>(graph(`/${accountId}/insights?fields=spend&date_preset=today&access_token=${encodeURIComponent(token)}`)),
  ]);
  return { ...toAccount(acc), todaySpendCents: Math.round(Number(today.data?.[0]?.spend ?? 0) * 100) };
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

export type DailyMetric = {
  campaignExternalId: string;
  day: string;
  impressions: number;
  reach: number | null;
  clicks: number;
  spendCents: number;
  conversions: number | null;
  conversionValueCents: number | null;
};

type InsightRow = { date_start: string; impressions?: string; reach?: string; clicks?: string; spend?: string; actions?: MetaAction[]; action_values?: MetaAction[] };

function toMetric(r: InsightRow) {
  return {
    day: r.date_start,
    impressions: Number(r.impressions ?? 0),
    reach: r.reach ? Number(r.reach) : null,
    clicks: Number(r.clicks ?? 0),
    // "spend" e "action_values" vêm na moeda da conta como decimal (ex.: "12.34").
    spendCents: Math.round(Number(r.spend ?? 0) * 100),
    conversions: r.actions ? sumConversionActions(r.actions) : null,
    conversionValueCents: r.action_values ? Math.round(sumConversionActions(r.action_values) * 100) : null,
  };
}

function insightsUrl(token: string, accountId: string, level: "campaign" | "ad", since: string, until: string) {
  const q = new URLSearchParams({
    level,
    fields: `${level}_id,impressions,reach,clicks,spend,actions,action_values`,
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    limit: "500",
    access_token: token,
  });
  return graph(`/${accountId}/insights?${q.toString()}`);
}

export async function metaDailyInsights(token: string, accountId: string, since: string, until: string): Promise<DailyMetric[]> {
  const rows = await all<InsightRow & { campaign_id: string }>(insightsUrl(token, accountId, "campaign", since, until), 20000);
  return rows.map((r) => ({ campaignExternalId: r.campaign_id, ...toMetric(r) }));
}

export type AdDailyMetric = Omit<DailyMetric, "campaignExternalId"> & { adExternalId: string };

export async function metaAdDailyInsights(token: string, accountId: string, since: string, until: string): Promise<AdDailyMetric[]> {
  const rows = await all<InsightRow & { ad_id: string }>(insightsUrl(token, accountId, "ad", since, until), 50000);
  return rows.map((r) => ({ adExternalId: r.ad_id, ...toMetric(r) }));
}

export type AdSetInfo = { externalId: string; campaignExternalId: string; name: string; status: string; optimizationGoal: string | null; dailyBudgetCents: number | null };

export async function metaAdSets(token: string, accountId: string): Promise<AdSetInfo[]> {
  const rows = await all<{ id: string; name: string; campaign_id: string; effective_status: string; optimization_goal?: string; daily_budget?: string }>(
    graph(`/${accountId}/adsets?fields=id,name,campaign_id,effective_status,optimization_goal,daily_budget&limit=200&access_token=${encodeURIComponent(token)}`),
    5000,
  );
  return rows.map((a) => ({
    externalId: a.id,
    campaignExternalId: a.campaign_id,
    name: a.name,
    status: a.effective_status,
    optimizationGoal: a.optimization_goal ?? null,
    dailyBudgetCents: cents(a.daily_budget),
  }));
}

export type AdInfo = {
  externalId: string;
  campaignExternalId: string;
  adSetExternalId: string | null;
  name: string;
  status: string;
  format: string | null;
  headline: string | null;
  body: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
};

// Só guardamos URLs https (a tabela também recusa outras).
const httpsOnly = (u: string | null | undefined) => (u && /^https:\/\//.test(u) ? u : null);
const clip = (v: string | null | undefined, max: number) => (v ? v.slice(0, max) : null);

type StoryData = { name?: string; title?: string; message?: string; picture?: string; image_url?: string };
type MetaCreative = { title?: string; body?: string; image_url?: string; thumbnail_url?: string; object_type?: string; object_story_spec?: { link_data?: StoryData; video_data?: StoryData } };

export async function metaAds(token: string, accountId: string): Promise<AdInfo[]> {
  const fields = "id,name,campaign_id,adset_id,effective_status,preview_shareable_link,creative{title,body,image_url,thumbnail_url,object_type,object_story_spec}";
  const rows = await all<{ id: string; name: string; campaign_id: string; adset_id?: string; effective_status: string; preview_shareable_link?: string; creative?: MetaCreative }>(
    graph(`/${accountId}/ads?${new URLSearchParams({ fields, thumbnail_width: "320", thumbnail_height: "320", limit: "100", access_token: token })}`),
    5000,
  );
  return rows.map((a) => {
    const c = a.creative ?? {};
    // Criativos de link/vídeo guardam título e texto no object_story_spec.
    const story = c.object_story_spec?.link_data ?? c.object_story_spec?.video_data;
    return {
      externalId: a.id,
      campaignExternalId: a.campaign_id,
      adSetExternalId: a.adset_id ?? null,
      name: a.name,
      status: a.effective_status,
      format: c.object_type ?? null,
      headline: clip(c.title ?? story?.name ?? story?.title, 500),
      body: clip(c.body ?? story?.message, 2000),
      // A URL da miniatura da Meta expira; a sincronização diária a renova.
      imageUrl: httpsOnly(c.thumbnail_url ?? c.image_url ?? story?.picture ?? story?.image_url),
      linkUrl: httpsOnly(a.preview_shareable_link),
    };
  });
}

// ----------------------------------------------------------------------------
// Edição (exige ads_management). Mudanças valem na hora na conta de anúncios.

async function post<T>(path: string, token: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(graph(path), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, access_token: token }),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  const data = (await res.json().catch(() => ({}))) as T & GraphError & { error?: { error_user_msg?: string } };
  if (!res.ok || data.error)
    throw Object.assign(new Error("meta_api"), {
      code: data.error?.code,
      subcode: data.error?.error_subcode,
      // Mensagem da Meta para o usuário, quando existe (ex.: orçamento abaixo do mínimo).
      userMessage: (data.error as { error_user_msg?: string } | undefined)?.error_user_msg ?? data.error?.message,
    });
  return data;
}

/** Campanha, conjunto ou anúncio: status ACTIVE/PAUSED, nome ou orçamento diário (centavos). */
export async function metaUpdate(token: string, externalId: string, changes: { status?: "ACTIVE" | "PAUSED"; name?: string; dailyBudgetCents?: number }) {
  const params: Record<string, string> = {};
  if (changes.status) params.status = changes.status;
  if (changes.name) params.name = changes.name;
  if (changes.dailyBudgetCents != null) params.daily_budget = String(changes.dailyBudgetCents);
  await post(`/${externalId}`, token, params);
}

/** Duplica campanha (com conjuntos e anúncios) ou conjunto; a cópia nasce pausada. */
export async function metaDuplicate(token: string, level: "campaign" | "adset", externalId: string) {
  const r = await post<{ copied_campaign_id?: string; copied_adset_id?: string }>(`/${externalId}/copies`, token, {
    deep_copy: "true",
    status_option: "PAUSED",
  });
  return level === "campaign" ? (r.copied_campaign_id ?? null) : (r.copied_adset_id ?? null);
}
