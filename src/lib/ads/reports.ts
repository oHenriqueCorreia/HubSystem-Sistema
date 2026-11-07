import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto";
import { wahaGroups, wahaSendText, type WahaConn } from "@/lib/waha";
import { todayLocal } from "@/domain/shared/dates";
import { clientReport, testMessage, type ClientPeriod, type Metrics, type Platform, type Templates } from "@/domain/ads/report-message";

// Relatórios e alertas de anúncios enviados a um grupo do WhatsApp (número conectado por QR Code).
// Uma mensagem por cliente; contas sem cliente saem com o nome da conta.

export type ReportKind = "teste" | "alerta" | "diario" | "semanal" | "mensal";
export type PeriodKind = "diario" | "semanal" | "mensal";

export type ReportSettings = {
  organization_id: string;
  whatsapp_number_id: string | null;
  group_id: string | null;
  group_name: string | null;
  alerts_enabled: boolean;
  daily_enabled: boolean;
  weekly_enabled: boolean;
  monthly_enabled: boolean;
  monthly_day: number;
  send_time: string;
  templates: Templates;
};

type Db = ReturnType<typeof createAdminClient>;

const daysBefore = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

/** Período de cada relatório: até ontem (o dia de hoje ainda não fechou). */
export function periodOf(kind: PeriodKind, today: string) {
  const to = daysBefore(today, 1);
  const from = kind === "diario" ? to : daysBefore(today, kind === "semanal" ? 7 : 30);
  return { from, to };
}

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
  if (!data) return null;
  return { ...(data as ReportSettings), templates: ((data as { templates?: Templates }).templates ?? {}) as Templates };
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
    if (!conn) throw Object.assign(new Error("numero"), { detail: "O WhatsApp escolhido não está conectado. Conecte de novo em Comercial → Atendimento." });
    await wahaSendText(conn, s.group_id, msg.text.slice(0, 4000));
    return { sent: true as const };
  } catch (e) {
    const detail = (e as { detail?: string }).detail;
    const status = (e as { status?: number }).status;
    const error = detail && !status ? detail : status ? `O servidor do WhatsApp recusou o envio (${status}). Confira se ele está ligado.` : "Não foi possível falar com o servidor do WhatsApp. Confira se ele está ligado.";
    await admin.from("ads_report_log").update({ status: "falhou", error: error.slice(0, 500) }).eq("id", id);
    return { sent: false as const, reason: "falhou" as const, error };
  }
}

type AccountRow = { id: string; name: string; provider: Platform; ad_client: { name: string } | { name: string }[] | null };

const ZERO: Metrics = { spendCents: 0, impressions: 0, reach: 0, clicks: 0, conversions: 0 };

/** Totais do período agrupados por cliente, na ordem alfabética. */
export async function clientPeriods(organizationId: string, from: string, to: string, db: Db = createAdminClient()): Promise<ClientPeriod[]> {
  const { data, error } = await db.from("ad_accounts").select("id, name, provider, ad_client:ad_clients(name)").eq("organization_id", organizationId).eq("is_selected", true);
  if (error) throw error;
  const accounts = (data ?? []) as AccountRow[];
  if (!accounts.length) return [];
  const { data: totals, error: tErr } = await db.rpc("ad_report_accounts", { p_accounts: accounts.map((a) => a.id), p_from: from, p_to: to });
  if (tErr) throw tErr;
  const byAccount = new Map(
    ((totals ?? []) as { account_id: string; impressions: number; reach: number; clicks: number; spend_cents: number; conversions: number }[]).map((r) => [
      r.account_id,
      { spendCents: Number(r.spend_cents), impressions: Number(r.impressions), reach: Number(r.reach ?? 0), clicks: Number(r.clicks), conversions: Number(r.conversions) },
    ]),
  );
  const clients = new Map<string, ClientPeriod>();
  for (const a of accounts) {
    const client = (Array.isArray(a.ad_client) ? a.ad_client[0] : a.ad_client)?.name ?? a.name;
    const m = byAccount.get(a.id) ?? ZERO;
    const c = clients.get(client) ?? { client, platforms: [], ...ZERO };
    clients.set(client, {
      client,
      platforms: c.platforms.includes(a.provider) ? c.platforms : [...c.platforms, a.provider].sort(),
      spendCents: c.spendCents + m.spendCents,
      impressions: c.impressions + m.impressions,
      reach: c.reach + m.reach,
      clicks: c.clicks + m.clicks,
      conversions: c.conversions + m.conversions,
    });
  }
  return [...clients.values()].sort((a, b) => a.client.localeCompare(b.client, "pt-BR"));
}

/** Mensagens de um relatório, uma por cliente. */
export async function buildReports(organizationId: string, kind: PeriodKind, opts: { today?: string; db?: Db; templates?: Templates | null } = {}) {
  const { from, to } = periodOf(kind, opts.today ?? todayLocal());
  const clients = await clientPeriods(organizationId, from, to, opts.db);
  return { from, to, messages: clients.map((c) => ({ client: c.client, ...clientReport(kind, c, from, to, opts.templates) })) };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendReports(organizationId: string, kind: PeriodKind, settings: ReportSettings, keyPrefix: string) {
  const r = await buildReports(organizationId, kind, { templates: settings.templates });
  let sent = 0;
  let failed: string | null = null;
  for (const m of r.messages) {
    const res = await sendToGroup(organizationId, { kind, key: `${keyPrefix}:${r.to}:${m.client}`, title: m.title, text: m.text }, settings);
    if (res.sent) {
      sent++;
      // Intervalo entre mensagens: o WhatsApp desconfia de rajadas.
      await pause(1500);
    } else if (res.reason === "falhou") failed = res.error;
  }
  return { sent, total: r.messages.length, failed };
}

export async function sendTest(organizationId: string) {
  const s = await getReportSettings(organizationId);
  const today = todayLocal();
  const { from, to } = periodOf("semanal", today);
  const clients = await clientPeriods(organizationId, from, to);
  const m = testMessage(s?.group_name ?? "grupo", clients.length);
  return sendToGroup(organizationId, { kind: "teste", key: `teste:${Date.now()}`, ...m }, s);
}

/** Relatório agora, a pedido: não conta como o envio automático. */
export async function sendReportNow(organizationId: string, kind: PeriodKind) {
  const s = await getReportSettings(organizationId);
  if (!s?.group_id) return { sent: 0, total: 0, failed: "Escolha o WhatsApp e o grupo antes de enviar." };
  return sendReports(organizationId, kind, s, `${kind}:manual:${Date.now()}`);
}

/** Minutos desde 00:00 em São Paulo. */
function localMinutes(now: Date) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now).split(":").map(Number);
  return h * 60 + m;
}

/** Envios automáticos no horário escolhido: diário, semanal (segundas) e mensal (no dia escolhido). */
export async function runScheduledReports(organizationId: string, now = new Date()) {
  const s = await getReportSettings(organizationId);
  if (!s?.group_id) return [];
  const [h, m] = s.send_time.split(":").map(Number);
  const start = h * 60 + m;
  const nowMin = localMinutes(now);
  // Janela de 15 minutos (o relógio do banco chama a cada 15); o registro impede envio repetido.
  if (nowMin < start || nowMin >= start + 15) return [];
  const today = todayLocal(now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const done: { kind: PeriodKind; sent: number; total: number }[] = [];
  if (s.daily_enabled) done.push({ kind: "diario", ...(await sendReports(organizationId, "diario", s, "diario")) });
  if (s.weekly_enabled && weekday === 1) done.push({ kind: "semanal", ...(await sendReports(organizationId, "semanal", s, "semanal")) });
  if (s.monthly_enabled && Number(today.slice(8, 10)) === s.monthly_day) done.push({ kind: "mensal", ...(await sendReports(organizationId, "mensal", s, "mensal")) });
  return done;
}
