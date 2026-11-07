import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, encrypt } from "@/lib/crypto";
import { formatBRL } from "@/domain/shared/money";
import { todayLocal } from "@/domain/shared/dates";
import { metaAccounts, metaAdDailyInsights, metaAds, metaAdSets, metaCampaigns, metaDailyInsights, type AdDailyMetric, type AdInfo, type AdSetInfo, type DailyMetric } from "./meta";
import {
  googleAdsAccessibleCustomers,
  googleAdsAdDailyInsights,
  googleAdsAdGroups,
  googleAdsAds,
  googleAdsCampaigns,
  googleAdsCustomer,
  googleAdsDailyInsights,
  googleAdsRefresh,
} from "./google-ads";

import { sendAlerts } from "./reports";
import type { AlertItem } from "@/domain/ads/report-message";

export type AdProvider = "meta_ads" | "google_ads";

type Connection = {
  id: string;
  organization_id: string;
  provider: AdProvider;
  token_enc: string;
  refresh_token_enc: string | null;
  expires_at: string | null;
  last_synced_at: string | null;
};

const daysAgo = (n: number) => todayLocal(new Date(Date.now() - n * 86_400_000));

/** Explica por que o Google não liberou nenhuma conta. */
function googleDiscoveryMessage(reasons: Set<string>) {
  if (reasons.has("CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION"))
    return "O projeto do Google Cloud ainda só tem acesso de teste. Peça o acesso Explorer na página da Google Ads API no Google Cloud; depois clique em “Sincronizar agora”.";
  if (reasons.size && [...reasons].every((r) => r === "CUSTOMER_NOT_ENABLED"))
    return "As contas deste e-mail estão canceladas ou ainda não foram ativadas no Google Ads.";
  if (reasons.has("USER_PERMISSION_DENIED"))
    return "Este e-mail não tem permissão nas contas. Se elas ficam numa conta de administrador (MCC), confira o ID em GOOGLE_ADS_LOGIN_CUSTOMER_ID.";
  return "Nenhuma conta de anúncio foi encontrada para este e-mail do Google.";
}

async function googleAccessToken(conn: Connection) {
  if (conn.expires_at && new Date(conn.expires_at).getTime() > Date.now() + 60_000) return decrypt(conn.token_enc);
  const t = await googleAdsRefresh(decrypt(conn.refresh_token_enc!));
  await createAdminClient()
    .from("integration_connections")
    .update({ token_enc: encrypt(t.access_token), expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString() })
    .eq("id", conn.id);
  return t.access_token;
}

type Admin = ReturnType<typeof createAdminClient>;
type Account = { id: string; external_id: string };

/**
 * Conjuntos/grupos, anúncios (com criativo) e métricas diárias por anúncio.
 * Conta sem métricas por anúncio ainda: traz 90 dias; depois, os últimos 7.
 */
async function syncAdLevel(admin: Admin, organizationId: string, provider: AdProvider, token: string, acc: Account, campaignIds: Map<string, string>, until: string) {
  const now = new Date().toISOString();
  const [sets, ads]: [AdSetInfo[], AdInfo[]] =
    provider === "meta_ads"
      ? await Promise.all([metaAdSets(token, acc.external_id), metaAds(token, acc.external_id)])
      : await Promise.all([googleAdsAdGroups(token, acc.external_id), googleAdsAds(token, acc.external_id)]);

  const setIds = new Map<string, string>();
  const setRows = sets
    .filter((s) => campaignIds.has(s.campaignExternalId))
    .map((s) => ({
      organization_id: organizationId,
      account_id: acc.id,
      campaign_id: campaignIds.get(s.campaignExternalId)!,
      external_id: s.externalId,
      name: s.name,
      status: s.status,
      optimization_goal: s.optimizationGoal,
      daily_budget_cents: s.dailyBudgetCents,
      updated_at: now,
    }));
  for (let i = 0; i < setRows.length; i += 500) {
    const { data, error } = await admin.from("ad_sets").upsert(setRows.slice(i, i + 500), { onConflict: "account_id,external_id" }).select("id, external_id");
    if (error) throw error;
    for (const r of data ?? []) setIds.set(r.external_id, r.id);
  }

  const adIds = new Map<string, string>();
  const adRows = ads
    .filter((a) => campaignIds.has(a.campaignExternalId))
    .map((a) => ({
      organization_id: organizationId,
      account_id: acc.id,
      campaign_id: campaignIds.get(a.campaignExternalId)!,
      ad_set_id: a.adSetExternalId ? (setIds.get(a.adSetExternalId) ?? null) : null,
      external_id: a.externalId,
      name: a.name,
      status: a.status,
      format: a.format,
      headline: a.headline,
      body: a.body,
      image_url: a.imageUrl,
      link_url: a.linkUrl,
      updated_at: now,
    }));
  for (let i = 0; i < adRows.length; i += 500) {
    const { data, error } = await admin.from("ads").upsert(adRows.slice(i, i + 500), { onConflict: "account_id,external_id" }).select("id, external_id");
    if (error) throw error;
    for (const r of data ?? []) adIds.set(r.external_id, r.id);
  }

  const { count } = await admin.from("ad_insights_ad_daily").select("id", { count: "exact", head: true }).eq("account_id", acc.id);
  const since = daysAgo(count ? 7 : 90);
  const daily: AdDailyMetric[] =
    provider === "meta_ads" ? await metaAdDailyInsights(token, acc.external_id, since, until) : await googleAdsAdDailyInsights(token, acc.external_id, since, until);
  const rows = daily
    .filter((d) => adIds.has(d.adExternalId) && /^\d{4}-\d{2}-\d{2}$/.test(d.day))
    .map((d) => ({
      organization_id: organizationId,
      account_id: acc.id,
      ad_id: adIds.get(d.adExternalId)!,
      day: d.day,
      impressions: d.impressions,
      reach: d.reach,
      clicks: d.clicks,
      spend_cents: d.spendCents,
      conversions: d.conversions,
      conversion_value_cents: d.conversionValueCents,
    }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("ad_insights_ad_daily").upsert(rows.slice(i, i + 500), { onConflict: "ad_id,day" });
    if (error) throw error;
  }
  return rows.length;
}

/**
 * Sincroniza uma conexão: contas → (selecionadas) campanhas e métricas diárias.
 * Conta ainda sem métricas: últimos 90 dias; depois, os últimos 7 (a Meta e o
 * Google ajustam números de dias recentes). Tudo idempotente (upsert por chave).
 * `accountId` sincroniza só aquela conta (usado ao ativá-la nos relatórios).
 */
export async function syncAds(organizationId: string, provider: AdProvider, accountId?: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("integration_connections").select("*").eq("organization_id", organizationId).eq("provider", provider).maybeSingle();
  const conn = data as Connection | null;
  if (!conn) return { accounts: 0, metrics: 0 };

  try {
    const token = provider === "meta_ads" ? decrypt(conn.token_enc) : await googleAccessToken(conn);
    if (provider === "meta_ads" && conn.expires_at && new Date(conn.expires_at).getTime() < Date.now()) {
      throw Object.assign(new Error("expired"), { code: 190 });
    }

    // 1) Contas autorizadas (pulado quando só uma conta é sincronizada).
    const googleReasons = new Set<string>();
    const accounts = accountId
      ? []
      : provider === "meta_ads"
        ? (await metaAccounts(token)).map((a) => ({ ...a }))
        : await Promise.all(
            (await googleAdsAccessibleCustomers(token)).slice(0, 50).map(async (id) => {
              const c = await googleAdsCustomer(token, id).catch((e: { reason?: string }) => {
                googleReasons.add(e.reason ?? "desconhecido");
                return null;
              });
              return c && !c.manager
                ? { externalId: id, name: c.name, currency: c.currency, status: c.status ?? "", balanceCents: null, spendCapCents: null, amountSpentCents: null }
                : null;
            }),
          ).then((r) => r.filter((x): x is NonNullable<typeof x> => Boolean(x)));
    // Nenhuma conta liberada: guarda o motivo do Google para mostrar na tela.
    const discoveryError = provider === "google_ads" && !accountId && !accounts.length ? googleDiscoveryMessage(googleReasons) : null;

    for (const a of accounts) {
      await admin.from("ad_accounts").upsert(
        {
          organization_id: organizationId,
          provider,
          external_id: a.externalId,
          name: a.name,
          currency: a.currency,
          status: a.status,
          balance_cents: a.balanceCents,
          spend_cap_cents: a.spendCapCents,
          amount_spent_cents: a.amountSpentCents,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,provider,external_id", ignoreDuplicates: false },
      );
    }

    // 2) Campanhas e métricas das contas selecionadas.
    let selectedQ = admin
      .from("ad_accounts")
      .select("id, external_id, name, currency, balance_cents, alert_balance_below_cents, alert_daily_spend_above_cents, alert_no_spend, ad_client:ad_clients(client_id)")
      .eq("organization_id", organizationId)
      .eq("provider", provider)
      .eq("is_selected", true);
    if (accountId) selectedQ = selectedQ.eq("id", accountId);
    const { data: selected, error: selectedError } = await selectedQ;
    if (selectedError) throw selectedError;
    const until = todayLocal();
    const yesterday = daysAgo(1);
    let metrics = 0;
    let adLevelFailed = false;
    const groupAlerts: (AlertItem & { key: string })[] = [];

    for (const acc of selected ?? []) {
      const campaigns = provider === "meta_ads" ? await metaCampaigns(token, acc.external_id) : await googleAdsCampaigns(token, acc.external_id);
      const ids = new Map<string, string>();
      const now = new Date().toISOString();
      const campaignRows = campaigns.map((c) => ({
        organization_id: organizationId,
        account_id: acc.id,
        external_id: c.externalId,
        name: c.name,
        status: c.status,
        objective: c.objective,
        daily_budget_cents: c.dailyBudgetCents,
        lifetime_budget_cents: c.lifetimeBudgetCents,
        updated_at: now,
      }));
      for (let i = 0; i < campaignRows.length; i += 500) {
        const { data: saved, error } = await admin.from("ad_campaigns").upsert(campaignRows.slice(i, i + 500), { onConflict: "account_id,external_id" }).select("id, external_id");
        if (error) throw error;
        for (const r of saved ?? []) ids.set(r.external_id, r.id);
      }

      // Histórico por conta: 90 dias na primeira vez (inclusive conta ativada depois da conexão).
      const { count: known } = await admin.from("ad_insights_daily").select("id", { count: "exact", head: true }).eq("account_id", acc.id);
      const since = daysAgo(known ? 7 : 90);
      const daily: DailyMetric[] =
        provider === "meta_ads" ? await metaDailyInsights(token, acc.external_id, since, until) : await googleAdsDailyInsights(token, acc.external_id, since, until);
      const rows = daily
        .filter((d) => ids.has(d.campaignExternalId) && /^\d{4}-\d{2}-\d{2}$/.test(d.day))
        .map((d) => ({
          organization_id: organizationId,
          account_id: acc.id,
          campaign_id: ids.get(d.campaignExternalId)!,
          day: d.day,
          impressions: d.impressions,
          reach: d.reach,
          clicks: d.clicks,
          spend_cents: d.spendCents,
          conversions: d.conversions,
          conversion_value_cents: d.conversionValueCents,
        }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await admin.from("ad_insights_daily").upsert(rows.slice(i, i + 500), { onConflict: "account_id,campaign_id,day" });
        if (error) throw error;
      }
      await admin.from("ad_accounts").update({ last_synced_at: new Date().toISOString() }).eq("id", acc.id);
      metrics += rows.length;

      // Conjuntos, anúncios e criativos. Uma falha aqui não perde as campanhas já gravadas.
      try {
        metrics += await syncAdLevel(admin, organizationId, provider, token, acc, ids, until);
      } catch (e) {
        adLevelFailed = true;
        console.error("[ads-sync] anúncios", provider, (e as { code?: unknown; status?: unknown }).code ?? (e as { status?: unknown }).status ?? "erro", (e as { detail?: string }).detail ?? "");
      }

      // 3) Alertas (um por conta por dia, sem repetição), só para quem enxerga a conta:
      // escopo "todos" ou quem trabalha no cliente ligado a ela.
      const adClient = (Array.isArray(acc.ad_client) ? acc.ad_client[0] : acc.ad_client) as { client_id: string | null } | null;
      const scope = { p_client: adClient?.client_id ?? undefined, p_record: true };
      const todaySpend = rows.filter((r) => r.day === until).reduce((s, r) => s + r.spend_cents, 0);
      if (acc.alert_daily_spend_above_cents != null && todaySpend > acc.alert_daily_spend_above_cents) {
        await admin.rpc("notify_users", {
          p_org: organizationId,
          p_perm: "ads.read",
          p_kind: "anuncio_gasto",
          p_title: `Gasto de hoje acima do limite em ${acc.name}`,
          p_body: `${formatBRL(todaySpend)} gastos hoje (limite ${formatBRL(acc.alert_daily_spend_above_cents)}).`,
          p_href: "/anuncios/contas",
          p_key: `ads_spend:${acc.id}:${until}`,
          ...scope,
        });
        groupAlerts.push({
          key: `ads_spend:${acc.id}:${until}`,
          title: `Gasto de hoje acima do limite em ${acc.name}`,
          detail: `${formatBRL(todaySpend)} gastos hoje (limite ${formatBRL(acc.alert_daily_spend_above_cents)}).`,
        });
      }
      const yesterdaySpend = rows.filter((r) => r.day === yesterday).reduce((s, r) => s + r.spend_cents, 0);
      if (acc.alert_no_spend && yesterdaySpend === 0) {
        await admin.rpc("notify_users", {
          p_org: organizationId,
          p_perm: "ads.read",
          p_kind: "anuncio_parado",
          p_title: `${acc.name} não gastou nada ontem`,
          p_body: "Confira o pagamento e se as campanhas estão ativas.",
          p_href: "/relatorios",
          p_key: `ads_nospend:${acc.id}:${yesterday}`,
          ...scope,
        });
        groupAlerts.push({ key: `ads_nospend:${acc.id}:${yesterday}`, title: `${acc.name} não gastou nada ontem`, detail: "Confira o pagamento e se as campanhas estão ativas." });
      }
      const { data: fresh } = await admin.from("ad_accounts").select("balance_cents").eq("id", acc.id).single();
      if (acc.alert_balance_below_cents != null && fresh?.balance_cents != null && fresh.balance_cents < acc.alert_balance_below_cents) {
        await admin.rpc("notify_users", {
          p_org: organizationId,
          p_perm: "ads.read",
          p_kind: "anuncio_saldo",
          p_title: `Saldo baixo na conta ${acc.name}`,
          p_body: `Saldo informado: ${formatBRL(fresh.balance_cents)} (alerta abaixo de ${formatBRL(acc.alert_balance_below_cents)}).`,
          p_href: "/anuncios/contas",
          p_key: `ads_balance:${acc.id}:${until}`,
          ...scope,
        });
        groupAlerts.push({
          key: `ads_balance:${acc.id}:${until}`,
          title: `Saldo baixo na conta ${acc.name}`,
          detail: `Saldo informado: ${formatBRL(fresh.balance_cents)} (alerta abaixo de ${formatBRL(acc.alert_balance_below_cents)}).`,
        });
      }
    }

    // Os mesmos alertas vão para o grupo do WhatsApp, se configurado. Falha no envio não derruba a sincronização.
    await sendAlerts(organizationId, groupAlerts).catch((e) => console.error("[ads-sync] whatsapp", (e as Error).message));

    await admin
      .from("integration_connections")
      .update({
        status: "ativa",
        last_error: discoveryError ?? (adLevelFailed ? "Campanhas atualizadas, mas conjuntos e anúncios não puderam ser sincronizados. Tente novamente mais tarde." : null),
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conn.id);
    return { accounts: accounts.length, metrics };
  } catch (e) {
    const err = e as { code?: number | string; status?: number };
    // Token inválido/expirado: Meta 190; Google invalid_grant/401.
    const expired = err.code === 190 || err.code === "invalid_grant" || err.status === 401;
    await admin
      .from("integration_connections")
      .update({ status: expired ? "expirada" : "erro", last_error: expired ? "O acesso expirou ou foi revogado. Conecte a conta novamente." : "Falha ao sincronizar com a plataforma.", updated_at: new Date().toISOString() })
      .eq("id", conn.id);
    if (expired) {
      await admin.rpc("notify_users", {
        p_org: organizationId,
        p_perm: "ads.manage",
        p_kind: "token_expirado",
        p_title: provider === "meta_ads" ? "Reconecte a conta da Meta" : "Reconecte a conta do Google Ads",
        p_body: "O acesso às contas de anúncios expirou.",
        p_href: "/anuncios/contas",
        p_key: `ads_expired:${provider}:${todayLocal()}`,
      });
      await sendAlerts(organizationId, [
        {
          key: `ads_expired:${provider}:${todayLocal()}`,
          title: provider === "meta_ads" ? "Reconecte a conta da Meta" : "Reconecte a conta do Google Ads",
          detail: "O acesso às contas de anúncios expirou. Os relatórios param até reconectar em Anúncios → Contas.",
        },
      ]).catch(() => null);
    }
    console.error("[ads-sync]", provider, err.code ?? err.status ?? "erro", (e as { detail?: string; message?: string }).detail ?? (e as Error).message);
    throw e;
  }
}
