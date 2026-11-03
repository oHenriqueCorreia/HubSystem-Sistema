import "server-only";
import { createClient } from "@/lib/supabase/server";

export type InboxSettings = {
  radar_client_minutes: number;
  radar_contact_hours: number;
  radar_notify: boolean;
  campaign_daily_limit: number;
  billing_enabled: boolean;
  billing_days_before: number;
  billing_message: string;
};

export const DEFAULT_SETTINGS: InboxSettings = {
  radar_client_minutes: 120,
  radar_contact_hours: 48,
  radar_notify: true,
  campaign_daily_limit: 200,
  billing_enabled: false,
  billing_days_before: 1,
  billing_message: "Olá {nome}! Lembrete: {descricao}, no valor de {valor}, vence em {vencimento}. Para não receber estes avisos, responda SAIR.",
};

export async function getInboxSettings(): Promise<InboxSettings> {
  const supabase = await createClient();
  const { data } = await supabase.from("inbox_settings").select("radar_client_minutes, radar_contact_hours, radar_notify, campaign_daily_limit, billing_enabled, billing_days_before, billing_message").maybeSingle();
  return (data as InboxSettings | null) ?? DEFAULT_SETTINGS;
}

export type RadarItem = { id: string; contact_e164: string; contact_name: string; last_message_at: string; assignee_id: string | null; last_inbound_at: string | null; number_id: string; lead: { id: string; name: string; contact_opt_out_at: string | null } | null };

/** Conversas abertas paradas: as de quem espera resposta e as que esperam o cliente. */
export async function getRadar(settings: InboxSettings, nowMs: number) {
  const supabase = await createClient();
  const columns = "id, contact_e164, contact_name, last_message_at, assignee_id, last_inbound_at, number_id, lead:leads(id, name, contact_opt_out_at)";
  const clientLimit = new Date(nowMs - settings.radar_client_minutes * 60_000).toISOString();
  const contactLimit = new Date(nowMs - settings.radar_contact_hours * 3600_000).toISOString();
  const [waitingUs, waitingClient] = await Promise.all([
    supabase.from("conversations").select(columns).eq("kind", "contato").eq("status", "aberta").eq("waiting_reply", true).lt("last_message_at", clientLimit).order("last_message_at").limit(100),
    supabase.from("conversations").select(columns).eq("kind", "contato").eq("only_history", false).eq("status", "aberta").eq("waiting_reply", false).lt("last_message_at", contactLimit).order("last_message_at").limit(100),
  ]);
  if (waitingUs.error) throw waitingUs.error;
  if (waitingClient.error) throw waitingClient.error;
  const shape = (rows: unknown[] | null) => ((rows ?? []) as (Omit<RadarItem, "lead"> & { lead: RadarItem["lead"] | RadarItem["lead"][] })[]).map((r) => ({ ...r, lead: Array.isArray(r.lead) ? (r.lead[0] ?? null) : r.lead }));
  return { waitingUs: shape(waitingUs.data), waitingClient: shape(waitingClient.data) };
}

export type InboxReport = {
  total: number;
  open: number;
  closed: number;
  waiting: number;
  avg_first_response_seconds: number | null;
  by_assignee: { assignee_id: string | null; name: string; total: number; closed: number; avg_first_response_seconds: number | null }[];
  by_outcome: { outcome: string; total: number }[];
};

export async function getInboxReport(from: string, to: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inbox_report", { p_from: from, p_to: to });
  if (error) throw error;
  return data as InboxReport;
}

export async function listAutomations() {
  const supabase = await createClient();
  const [automations, runs] = await Promise.all([
    supabase.from("automations").select("id, name, enabled, trigger, condition, actions, delay_minutes").order("created_at"),
    supabase.from("automation_runs").select("id, automation_id, status, detail, created_at").in("status", ["bloqueado", "erro"]).order("created_at", { ascending: false }).limit(20),
  ]);
  if (automations.error) throw automations.error;
  return { automations: automations.data ?? [], problems: runs.data ?? [] };
}

export async function listCampaigns() {
  const supabase = await createClient();
  const [campaigns, counts] = await Promise.all([
    supabase.from("campaigns").select("id, name, status, scheduled_at, created_at, template_name").order("created_at", { ascending: false }).limit(50),
    supabase.rpc("inbox_campaign_counts"),
  ]);
  if (campaigns.error) throw campaigns.error;
  if (counts.error) throw counts.error;
  const byId = new Map(((counts.data ?? []) as { campaign_id: string; total: number; enviados: number; bloqueados: number; erros: number; pendentes: number }[]).map((c) => [c.campaign_id, c]));
  return (campaigns.data ?? []).map((c) => {
    const n = byId.get(c.id);
    return { ...c, total: n?.total ?? 0, enviados: n?.enviados ?? 0, bloqueados: n?.bloqueados ?? 0, erros: n?.erros ?? 0, pendentes: n?.pendentes ?? 0 };
  });
}

export async function getOperationsSetup() {
  const supabase = await createClient();
  const [conversion, conversionLog, webhooks, inbound, billingLog] = await Promise.all([
    supabase.rpc("my_conversion_settings"),
    supabase.from("conversion_events").select("id, event_name, value_cents, status, error, created_at, ctwa_clid, provider").order("created_at", { ascending: false }).limit(20),
    supabase.rpc("my_webhook_endpoints"),
    supabase.from("inbound_hooks").select("id, name, last_used_at").order("created_at"),
    supabase.from("billing_reminders").select("transaction_id, status, detail, created_at").order("created_at", { ascending: false }).limit(20),
  ]);
  return {
    conversion: (((conversion.data ?? []) as { enabled: boolean; dataset_id: string; waba_id: string | null }[])[0] ?? null),
    conversionLog: (conversionLog.data ?? []) as { id: string; event_name: string; value_cents: number; status: string; error: string | null; created_at: string; ctwa_clid: string | null; provider: string | null }[],
    webhooks: (webhooks.data ?? []) as { id: string; name: string; url: string; events: string[]; enabled: boolean }[],
    inbound: (inbound.data ?? []) as { id: string; name: string; last_used_at: string | null }[],
    billingLog: (billingLog.data ?? []) as { transaction_id: string; status: string; detail: string | null; created_at: string }[],
  };
}
