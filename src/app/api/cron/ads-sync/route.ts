import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncAds, type AdProvider } from "@/lib/ads/sync";

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
  for (const c of data ?? []) {
    try {
      await syncAds(c.organization_id, c.provider as AdProvider);
      ok++;
    } catch {
      failed++;
    }
  }
  return NextResponse.json({ ok, failed });
}
