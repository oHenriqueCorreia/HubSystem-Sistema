import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runCadences } from "@/lib/cadence-runner";

export const maxDuration = 300;

/** Etapas automáticas das cadências (Vercel Cron, protegida por CRON_SECRET). */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.SUPABASE_SECRET_KEY) return NextResponse.json({ skipped: "not_configured" });
  return NextResponse.json(await runCadences());
}
