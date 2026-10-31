import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { googleConfigured, syncUser } from "@/lib/google/calendar";

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
  const { data } = await admin.from("google_calendar_connections").select("user_id").eq("status", "ativa").limit(500);
  let ok = 0;
  let failed = 0;
  for (const c of data ?? []) {
    try {
      await syncUser(c.user_id);
      ok++;
    } catch {
      failed++;
    }
  }
  return NextResponse.json({ ok, failed });
}
