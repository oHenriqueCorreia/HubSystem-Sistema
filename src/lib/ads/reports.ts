import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto";
import { wahaGroups, wahaSendText, type WahaConn } from "@/lib/waha";
import { todayLocal } from "@/domain/shared/dates";
import { alertsMessage, dailyReport, testMessage, weeklyReport, type AccountPeriod, type AlertItem } from "@/domain/ads/report-message";

// Alertas e relatórios de anúncios enviados a um grupo do WhatsApp (número conectado por QR Code).

export type ReportKind = "teste" | "alerta" | "diario" | "semanal";

export type ReportSettings = {
  organization_id: string;
  whatsapp_number_id: string | null;
  group_id: string | null;
  group_name: string | null;
  alerts_enabled: boolean;
  daily_enabled: boolean;
  weekly_enabled: boolean;
};

const daysBefore = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

/** Conexão do número escolhido, só se for desta organização e por QR Code. */
export async function groupConnection(organizationId: string, numberId: string): Promise<WahaConn | null> {
  const { data } = await createAdminClient().from("whatsapp_numbers").select("organization_id, provider, status, waha_url, waha_session, token_enc").eq("id", numberId).maybeSingle();
  if (!data || data.organization_id !== organizationId || data.provider !== "waha" || data.status === "desconectado") return null;
  return { url: data.waha_url as string, key: decrypt(data.token_enc), session: data.waha_session as string };
}

/** Grupos do número escolhido, em ordem alfabética. */
export async function listGroups(organizationId: string, numberId: string) {
  const conn = await groupConnection(organizationId, numberId);
  if (!conn) return null;
  return (await wahaGroups(conn)).filter((g) => g.name).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export async function getReportSettings(organizationId: string) {
  const { data } = await createAdminClient().from("ads_report_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  return (data as ReportSettings | null) ?? null;
}

/**
 * Envia uma mensagem ao grupo, no máximo uma vez por chave.
 * O registro é gravado antes do envio: duas execuções ao mesmo tempo não duplicam a mensagem.
 */
export async function sendToGroup(organizationId: string, msg: { kind: ReportKind; key: string; title: string; text: string }, settings?: ReportSettings | null) {
  const s = settings ?? (await getReportSettings(organizationId));
  if (!s?.whatsapp_number_id || !s.group_id) return { sent: false as const, reason: "sem_destino" as const };
  const admin = createAdminClient();
  const { data: claimed } = await admin
    .from("ads_report_log")
    .upsert(
      { organization_id: organizationId, kind: msg.kind, dedupe_key: msg.key.slice(0, 200), title: msg.title.slice(0, 200), body: msg.text.slice(0, 4000), status: "enviado" },
      { onConflict: "organization_id,dedupe_key", ignoreDuplicates: true },
    )
    .select("id");
  const id = claimed?.[0]?.id as string | undefined;
  if (!id) return { sent: false as const, reason: "repetido" as const };
  try {
    const conn = await groupConnection(organizationId, s.whatsapp_number_id);
    if (!conn) throw Object.assign(new Error("numero"), { detail: "O WhatsApp escolhido não está conectado." });
    await wahaSendText(conn, s.group_id, msg.text.slice(0, 4000));
    return { sent: true as const };
  } catch (e) {
    const detail = (e as { detail?: string }).detail;
    const status = (e as { status?: number }).status;
    const error = detail && !status ? detail : status ? `O servidor do WhatsApp recusou o envio (${status}).` : "Não foi possível falar com o servidor do WhatsApp.";
    await admin.from("ads_report_log").update({ status: "falhou", error: error.slice(0, 500) }).eq("id", id);
    return { sent: false as const, reason: "falhou" as const, error };
  }
}

type AccountRow = { id: string; name: string; provider: "meta_ads" | "google_ads"; ad_client: { name: string } | { name: string }[] | null };

type Db = ReturnType<typeof createAdminClient>;

async function selectedAccounts(organizationId: string, db: Db = createAdminClient()) {
  const { data, error } = await db
    .from("ad_accounts")
    .select("id, name, provider, ad_client:ad_clients(name)")
    .eq("organization_id", organizationId)
    .eq("is_selected", true);
  if (error) throw error;
  return (data ?? []) as AccountRow[];
}

async function totalsByAccount(db: Db, ids: string[], from: string, to: string) {
  if (!ids.length) return new Map<string, { spendCents: number; impressions: number; clicks: number; conversions: number }>();
  const { data, error } = await db.rpc("ad_report_accounts", { p_accounts: ids, p_from: from, p_to: to });
  if (error) throw error;
  return new Map(
    ((data ?? []) as { account_id: string; impressions: number; clicks: number; spend_cents: number; conversions: number }[]).map((r) => [
      r.account_id,
      { spendCents: Number(r.spend_cents), impressions: Number(r.impressions), clicks: Number(r.clicks), conversions: Number(r.conversions) },
    ]),
  );
}

const zero = { spendCents: 0, impressions: 0, clicks: 0, conversions: 0 };

async function period(db: Db, organizationId: string, from: string, to: string, compare?: { from: string; to: string }): Promise<AccountPeriod[]> {
  const accounts = await selectedAccounts(organizationId, db);
  const ids = accounts.map((a) => a.id);
  const [now, before] = await Promise.all([totalsByAccount(db, ids, from, to), compare ? totalsByAccount(db, ids, compare.from, compare.to) : Promise.resolve(null)]);
  return accounts.map((a) => {
    const client = Array.isArray(a.ad_client) ? a.ad_client[0] : a.ad_client;
    return { name: a.name, provider: a.provider, client: client?.name ?? null, ...(now.get(a.id) ?? zero), previous: before ? (before.get(a.id) ?? zero) : null };
  });
}

/** db: o cliente da pessoa (prévia, respeita o que ela enxerga) ou o administrador (envio). */
export async function buildDaily(organizationId: string, today = todayLocal(), db: Db = createAdminClient()) {
  const day = daysBefore(today, 1);
  return { day, ...dailyReport(day, await period(db, organizationId, day, day)) };
}

export async function buildWeekly(organizationId: string, today = todayLocal(), db: Db = createAdminClient()) {
  const to = daysBefore(today, 1);
  const from = daysBefore(today, 7);
  const accounts = await period(db, organizationId, from, to, { from: daysBefore(today, 14), to: daysBefore(today, 8) });
  return { from, to, ...weeklyReport(from, to, accounts) };
}

export async function sendTest(organizationId: string) {
  const s = await getReportSettings(organizationId);
  const accounts = await selectedAccounts(organizationId);
  const m = testMessage(s?.group_name ?? "grupo", accounts.length);
  return sendToGroup(organizationId, { kind: "teste", key: `teste:${Date.now()}`, ...m }, s);
}

/** Relatório agora, a pedido: não conta como o envio automático do dia. */
export async function sendReportNow(organizationId: string, kind: "diario" | "semanal") {
  const r = kind === "diario" ? await buildDaily(organizationId) : await buildWeekly(organizationId);
  return sendToGroup(organizationId, { kind, key: `${kind}:manual:${Date.now()}`, title: r.title, text: r.text });
}

/** Cada alerta sai uma vez por dia (a chave já leva a data). */
export async function sendAlerts(organizationId: string, items: (AlertItem & { key: string })[]) {
  if (!items.length) return;
  const s = await getReportSettings(organizationId);
  if (!s?.alerts_enabled) return;
  for (const item of items) await sendToGroup(organizationId, { kind: "alerta", key: `alerta:${item.key}`, ...alertsMessage([item]) }, s);
}

/** Envios automáticos: o diário todo dia e o semanal às segundas, uma vez cada. */
export async function runScheduledReports(organizationId: string, now = new Date()) {
  const s = await getReportSettings(organizationId);
  if (!s?.group_id) return;
  const today = todayLocal(now);
  if (s.daily_enabled) {
    const r = await buildDaily(organizationId, today);
    await sendToGroup(organizationId, { kind: "diario", key: `diario:${r.day}`, title: r.title, text: r.text }, s);
  }
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (s.weekly_enabled && weekday === 1) {
    const r = await buildWeekly(organizationId, today);
    await sendToGroup(organizationId, { kind: "semanal", key: `semanal:${r.to}`, title: r.title, text: r.text }, s);
  }
}
