import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runInboxJobs } from "@/lib/inbox-jobs";

export const maxDuration = 60;

/** Chamado pelo banco (pg_cron + pg_net) quando há trabalho do Atendimento na fila. */
export async function POST(request: NextRequest) {
  const token = request.headers.get("x-hub-tick") ?? "";
  const admin = createAdminClient();
  const { data: valid } = token ? await admin.rpc("push_check_token", { p_token: token }) : { data: false };
  if (!valid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runInboxJobs());
}
