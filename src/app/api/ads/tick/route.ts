import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runScheduledReports } from "@/lib/ads/reports";
import { checkAlerts } from "@/lib/ads/alerts";

export const maxDuration = 300;

/**
 * Chamado pelo relógio do banco (pg_cron + pg_net, a cada 15 minutos):
 *   job "relatorios": envia os relatórios das empresas no horário;
 *   job "alertas": confere saldo e gasto das contas com alerta (de hora em hora).
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get("x-hub-tick") ?? "";
  const admin = createAdminClient();
  const { data: valid } = token ? await admin.rpc("push_check_token", { p_token: token }) : { data: false };
  if (!valid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { job } = (await request.json().catch(() => ({}))) as { job?: string };
  const result: Record<string, unknown> = {};

  if (job === "relatorios") {
    const { data } = await admin.from("ads_report_settings").select("organization_id").not("group_id", "is", null).limit(500);
    for (const s of data ?? []) {
      try {
        result[s.organization_id] = await runScheduledReports(s.organization_id);
      } catch (e) {
        console.error("[ads-tick] relatórios", (e as Error).message);
      }
    }
  } else if (job === "alertas") {
    const { data } = await admin.from("integration_connections").select("organization_id").eq("status", "ativa").in("provider", ["meta_ads", "google_ads"]).limit(500);
    for (const org of new Set((data ?? []).map((c) => c.organization_id as string))) {
      try {
        result[org] = await checkAlerts(org);
      } catch (e) {
        console.error("[ads-tick] alertas", (e as Error).message);
      }
    }
  } else {
    return NextResponse.json({ error: "job" }, { status: 400 });
  }
  return NextResponse.json({ job, result });
}
