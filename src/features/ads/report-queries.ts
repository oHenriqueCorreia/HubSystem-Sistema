import "server-only";
import { createClient } from "@/lib/supabase/server";

export type ReportSettingsView = {
  whatsapp_number_id: string | null;
  group_id: string | null;
  group_name: string | null;
  alerts_enabled: boolean;
  daily_enabled: boolean;
  weekly_enabled: boolean;
  monthly_enabled: boolean;
  monthly_day: number;
  send_time: string;
  templates: Partial<Record<string, string>>;
};

export type ReportNumber = { id: string; label: string; connected: boolean };

export type ReportAccount = {
  id: string;
  name: string;
  provider: "meta_ads" | "google_ads";
  currency: string;
  status: string | null;
  balance_cents: number | null;
  is_prepay: boolean | null;
  client: string | null;
  alert_balance_below_cents: number | null;
  alert_daily_spend_above_cents: number | null;
  alert_no_spend: boolean;
};

export type ReportLogEntry = { id: string; kind: "teste" | "alerta" | "diario" | "semanal" | "mensal"; title: string; body: string; status: "enviado" | "falhou"; error: string | null; sent_at: string };

export async function getReportsPage(canManage: boolean) {
  const supabase = await createClient();
  const [settings, accounts, log, numbers] = await Promise.all([
    supabase.from("ads_report_settings").select("whatsapp_number_id, group_id, group_name, alerts_enabled, daily_enabled, weekly_enabled, monthly_enabled, monthly_day, send_time, templates").maybeSingle(),
    supabase
      .from("ad_accounts")
      .select("id, name, provider, currency, status, balance_cents, is_prepay, alert_balance_below_cents, alert_daily_spend_above_cents, alert_no_spend, ad_client:ad_clients(name)")
      .eq("is_selected", true)
      .order("name"),
    supabase.from("ads_report_log").select("id, kind, title, body, status, error, sent_at").order("sent_at", { ascending: false }).limit(30),
    // A lista de números só é lida por quem pode configurar o destino.
    canManage ? supabase.rpc("my_whatsapp_numbers") : Promise.resolve({ data: [], error: null }),
  ]);
  if (accounts.error) throw accounts.error;
  return {
    settings: (settings.data as ReportSettingsView | null) ?? null,
    accounts: ((accounts.data ?? []) as (Omit<ReportAccount, "client"> & { ad_client: { name: string } | { name: string }[] | null })[]).map(({ ad_client, ...a }) => ({
      ...a,
      client: (Array.isArray(ad_client) ? ad_client[0]?.name : ad_client?.name) ?? null,
    })) as ReportAccount[],
    log: (log.data ?? []) as ReportLogEntry[],
    // Só o WhatsApp por QR Code envia para grupos (a API oficial da Meta não envia).
    numbers: ((numbers.data ?? []) as { id: string; display_phone: string; verified_name: string; status: string; provider: string }[])
      .filter((n) => n.provider === "waha")
      .map((n) => ({ id: n.id, label: [n.verified_name, n.display_phone].filter(Boolean).join(" · ") || "WhatsApp", connected: n.status === "ativo" })) as ReportNumber[],
  };
}
