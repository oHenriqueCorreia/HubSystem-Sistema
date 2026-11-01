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
 * Primeira vez: últimos 90 dias; depois, os últimos 7 (a Meta e o Google
 * ajustam números de dias recentes). Tudo idempotente (upsert por chave).
 */
export async function syncAds(organizationId: string, provider: AdProvider) {
  const admin = createAdminClient();
  const { data } = await admin.from("integration_connections").select("*").eq("organization_id", organizationId).eq("provider", provider).maybeSingle();
  const conn = data as Connection | null;
  if (!conn) return { accounts: 0, metrics: 0 };

  try {
    const token = provider === "meta_ads" ? decrypt(conn.token_enc) : await googleAccessToken(conn);
    if (provider === "meta_ads" && conn.expires_at && new Date(conn.expires_at).getTime() < Date.now()) {
      throw Object.assign(new Error("expired"), { code: 190 });
    }

    // 1) Contas autorizadas.
    const accounts =
      provider === "meta_ads"
        ? (await metaAccounts(token)).map((a) => ({ ...a }))
        : await Promise.all(
            (await googleAdsAccessibleCustomers(token)).slice(0, 50).map(async (id) => {
              const c = await googleAdsCustomer(token, id).catch(() => null);
              return c && !c.manager
                ? { externalId: id, name: c.name, currency: c.currency, status: c.status ?? "", balanceCents: null, spendCapCents: null, amountSpentCents: null }
                : null;
            }),
          ).then((r) => r.filter((x): x is NonNullable<typeof x> => Boolean(x)));

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
    const { data: selected } = await admin
      .from("ad_accounts")
      .select("id, external_id, name, currency, balance_cents, alert_balance_below_cents, alert_daily_spend_above_cents")
      .eq("organization_id", organizationId)
      .eq("provider", provider)
      .eq("is_selected", true);
    const since = daysAgo(conn.last_synced_at ? 7 : 90);
    const until = todayLocal();
    let metrics = 0;
    let adLevelFailed = false;

    for (const acc of selected ?? []) {
      const campaigns = provider === "meta_ads" ? await metaCampaigns(token, acc.external_id) : await googleAdsCampaigns(token, acc.external_id);
      const ids = new Map<string, string>();
      for (const c of campaigns) {
        const { data: row } = await admin
          .from("ad_campaigns")
          .upsert(
            {
              organization_id: organizationId,
              account_id: acc.id,
              external_id: c.externalId,
              name: c.name,
              status: c.status,
              objective: c.objective,
              daily_budget_cents: c.dailyBudgetCents,
              lifetime_budget_cents: c.lifetimeBudgetCents,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "account_id,external_id" },
          )
          .select("id")
          .single();
        if (row) ids.set(c.externalId, row.id);
      }

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
        await admin.from("ad_insights_daily").upsert(rows.slice(i, i + 500), { onConflict: "account_id,campaign_id,day" });
      }
      metrics += rows.length;

      // Conjuntos, anúncios e criativos. Uma falha aqui não perde as campanhas já gravadas.
      try {
        metrics += await syncAdLevel(admin, organizationId, provider, token, acc, ids, until);
      } catch (e) {
        adLevelFailed = true;
        console.error("[ads-sync] anúncios", provider, (e as { code?: unknown; status?: unknown }).code ?? (e as { status?: unknown }).status ?? "erro");
      }

      // 3) Alertas (um por conta por dia, sem repetição).
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
        });
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
        });
      }
    }

    await admin
      .from("integration_connections")
      .update({
        status: "ativa",
        last_error: adLevelFailed ? "Campanhas atualizadas, mas conjuntos e anúncios não puderam ser sincronizados. Tente novamente mais tarde." : null,
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
    }
    console.error("[ads-sync]", provider, err.code ?? err.status ?? "erro");
    throw e;
  }
}
