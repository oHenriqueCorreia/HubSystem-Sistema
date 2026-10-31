import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { googleConfigured, syncUser, watchCalendar } from "@/lib/google/calendar";

export const maxDuration = 300;

/** Sincronização periódica (Vercel Cron). Protegida por CRON_SECRET. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!googleConfigured()) return NextResponse.json({ skipped: "not_configured" });

  const admin = createAdminClient();
  const { data } = await admin.from("google_calendar_connections").select("user_id, channel_expires_at").eq("status", "ativa").limit(500);
  let ok = 0;
  let failed = 0;
  let renewed = 0;
  // Canais push duram até 7 dias: renova os que vencem nas próximas 48 horas.
  const renewBefore = Date.now() + 2 * 86_400_000;
  for (const c of data ?? []) {
    try {
      await syncUser(c.user_id);
      ok++;
      if (!c.channel_expires_at || new Date(c.channel_expires_at).getTime() < renewBefore) {
        if (await watchCalendar(c.user_id)) renewed++;
      }
    } catch {
      failed++;
    }
  }
  return NextResponse.json({ ok, failed, renewed });
}
