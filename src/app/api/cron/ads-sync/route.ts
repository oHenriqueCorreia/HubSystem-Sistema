import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncAds, type AdProvider } from "@/lib/ads/sync";
import { runScheduledReports } from "@/lib/ads/reports";

export const maxDuration = 300;

/** Sincronização diária das contas de anúncios (Vercel Cron, protegida por CRON_SECRET). */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.SUPABASE_SECRET_KEY) return NextResponse.json({ skipped: "not_configured" });

  const { data } = await createAdminClient().from("integration_connections").select("organization_id, provider").eq("status", "ativa").limit(500);
  let ok = 0;
  let failed = 0;
  const ads = (data ?? []).filter((c) => c.provider === "meta_ads" || c.provider === "google_ads");
  for (const c of ads) {
    try {
      await syncAds(c.organization_id, c.provider as AdProvider);
      ok++;
    } catch {
      failed++;
    }
  }

  // Com os números do dia anterior já trazidos, os relatórios vão para o grupo do WhatsApp.
  let reports = 0;
  const { data: targets } = await createAdminClient().from("ads_report_settings").select("organization_id").not("group_id", "is", null).limit(500);
  for (const t of targets ?? []) {
    try {
      await runScheduledReports(t.organization_id);
      reports++;
    } catch (e) {
      console.error("[ads-reports]", (e as Error).message);
    }
  }
  return NextResponse.json({ ok, failed, reports });
}
