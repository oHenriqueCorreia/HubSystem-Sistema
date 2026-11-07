import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayLocal } from "@/domain/shared/dates";
import { balanceAlert, connectionAlert, idleAlert, spendAlert, type AccountInfo } from "@/domain/ads/report-message";
import { metaAccountLive } from "./meta";
import { googleAdsAccountLive } from "./google-ads";
import { accessToken, getConnection, type AdProvider } from "./tokens";
import { getReportSettings, sendToGroup, type ReportSettings } from "./reports";

// Alertas de contas de anúncio: conferidos de hora em hora (relógio do banco) e após cada sincronização.
// Cada alerta sai uma vez por dia por conta: na central de notificações e no grupo do WhatsApp.

type AlertAccount = {
  id: string;
  provider: AdProvider;
  external_id: string;
  name: string;
  status: string | null;
  is_prepay: boolean | null;
  last_synced_at: string | null;
  alert_balance_below_cents: number | null;
  alert_daily_spend_above_cents: number | null;
  alert_no_spend: boolean;
  ad_client: { name: string; client_id: string | null } | { name: string; client_id: string | null }[] | null;
};

const dayBefore = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

type Alert = { key: string; kind: string; title: string; detail: string; text: string; clientId: string | null };

async function deliver(organizationId: string, alerts: Alert[], settings: ReportSettings | null) {
  const admin = createAdminClient();
  for (const a of alerts) {
    // Só quem enxerga a conta é avisado: escopo "todos" ou quem trabalha no cliente ligado a ela.
    await admin.rpc("notify_users", {
      p_org: organizationId,
      p_perm: "ads.read",
      p_kind: a.kind,
      p_title: a.title,
      p_body: a.detail,
      p_href: "/relatorios",
      p_key: a.key,
      ...(a.clientId !== undefined ? { p_client: a.clientId ?? undefined, p_record: true } : {}),
    });
    if (settings?.alerts_enabled) await sendToGroup(organizationId, { kind: "alerta", key: `alerta:${a.key}`, title: a.title, text: a.text }, settings);
  }
}

/** Confere saldo, gasto de hoje e conta parada das contas com alerta. Devolve quantos alertas saíram. */
export async function checkAlerts(organizationId: string, only?: AdProvider) {
  const admin = createAdminClient();
  let q = admin
    .from("ad_accounts")
    .select("id, provider, external_id, name, status, is_prepay, last_synced_at, alert_balance_below_cents, alert_daily_spend_above_cents, alert_no_spend, ad_client:ad_clients(name, client_id)")
    .eq("organization_id", organizationId)
    .eq("is_selected", true)
    .or("alert_balance_below_cents.not.is.null,alert_daily_spend_above_cents.not.is.null,alert_no_spend.eq.true");
  if (only) q = q.eq("provider", only);
  const { data, error } = await q;
  if (error) throw error;
  const accounts = (data ?? []) as AlertAccount[];
  if (!accounts.length) return 0;

  const settings = await getReportSettings(organizationId);
  const templates = settings?.templates ?? null;
  const today = todayLocal();
  const yesterday = dayBefore(today);
  const todayStart = new Date(`${today}T00:00:00-03:00`).getTime();
  const alerts: Alert[] = [];

  for (const provider of ["meta_ads", "google_ads"] as const) {
    const list = accounts.filter((a) => a.provider === provider);
    if (!list.length) continue;
    const conn = await getConnection(organizationId, provider);
    if (!conn || conn.status !== "ativa") continue;
    let token: string;
    try {
      token = await accessToken(conn);
    } catch {
      continue;
    }

    // Gasto de ontem, do banco, para "conta parada".
    const idleIds = list.filter((a) => a.alert_no_spend && a.last_synced_at && new Date(a.last_synced_at).getTime() >= todayStart).map((a) => a.id);
    const spentYesterday = new Map<string, number>();
    if (idleIds.length) {
      const { data: rows } = await admin.rpc("ad_report_accounts", { p_accounts: idleIds, p_from: yesterday, p_to: yesterday });
      for (const r of (rows ?? []) as { account_id: string; spend_cents: number }[]) spentYesterday.set(r.account_id, Number(r.spend_cents));
    }

    for (const a of list) {
      const client = Array.isArray(a.ad_client) ? a.ad_client[0] : a.ad_client;
      try {
        const needsLive = a.alert_balance_below_cents != null || a.alert_daily_spend_above_cents != null;
        let status = a.status;
        let isPrepay = a.is_prepay;
        let balance: number | null = null;
        let todaySpend = 0;
        if (needsLive) {
          if (provider === "meta_ads") {
            const live = await metaAccountLive(token, a.external_id);
            ({ status, isPrepay } = live);
            balance = live.balanceCents;
            todaySpend = live.todaySpendCents;
            await admin.from("ad_accounts").update({ status, is_prepay: isPrepay, balance_cents: balance }).eq("id", a.id);
          } else {
            const live = await googleAdsAccountLive(token, a.external_id);
            balance = live.balanceCents;
            todaySpend = live.todaySpendCents;
            if (balance !== null) await admin.from("ad_accounts").update({ balance_cents: balance }).eq("id", a.id);
          }
        }
        const info: AccountInfo = { name: a.name, client: client?.name ?? null, provider, status, isPrepay };
        const clientId = client?.client_id ?? null;

        if (a.alert_balance_below_cents != null && balance !== null && balance < a.alert_balance_below_cents) {
          alerts.push({ key: `ads_balance:${a.id}:${today}`, kind: "anuncio_saldo", clientId, ...balanceAlert(info, balance, a.alert_balance_below_cents, templates) });
        }
        if (a.alert_daily_spend_above_cents != null && todaySpend > a.alert_daily_spend_above_cents) {
          alerts.push({ key: `ads_spend:${a.id}:${today}`, kind: "anuncio_gasto", clientId, ...spendAlert(info, todaySpend, a.alert_daily_spend_above_cents, templates) });
        }
        if (idleIds.includes(a.id) && (spentYesterday.get(a.id) ?? 0) === 0) {
          alerts.push({ key: `ads_nospend:${a.id}:${yesterday}`, kind: "anuncio_parado", clientId, ...idleAlert(info, yesterday, templates) });
        }
      } catch (e) {
        console.error("[ads-alerts]", provider, a.external_id, (e as { code?: unknown; status?: unknown }).code ?? (e as { status?: unknown }).status ?? (e as Error).message);
      }
    }
  }

  await deliver(organizationId, alerts, settings);
  return alerts.length;
}

/** Conexão expirada: avisa quem gerencia e o grupo, uma vez por dia. */
export async function sendConnectionAlert(organizationId: string, provider: AdProvider) {
  const settings = await getReportSettings(organizationId);
  const a = connectionAlert(provider, settings?.templates ?? null);
  const key = `ads_expired:${provider}:${todayLocal()}`;
  await createAdminClient().rpc("notify_users", {
    p_org: organizationId,
    p_perm: "ads.manage",
    p_kind: "token_expirado",
    p_title: a.title,
    p_body: a.detail,
    p_href: "/anuncios/contas",
    p_key: key,
  });
  if (settings?.alerts_enabled) await sendToGroup(organizationId, { kind: "alerta", key: `alerta:${key}`, title: a.title, text: a.text }, settings);
}
