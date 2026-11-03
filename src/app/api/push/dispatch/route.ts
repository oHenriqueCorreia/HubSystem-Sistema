import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPush, type PushPayload } from "@/lib/push";

export const maxDuration = 60;

type Pending = { id: string; user_id: string; kind: string; title: string; body: string | null; href: string | null };

// Mais que isso de uma vez vira um resumo, para não encher o celular.
const MAX_INDIVIDUAL = 3;

/** Chamado pelo banco (pg_cron + pg_net) quando há notificação nova para um aparelho inscrito. */
export async function POST(request: NextRequest) {
  const token = request.headers.get("x-hub-tick") ?? "";
  const admin = createAdminClient();
  const { data: valid } = token ? await admin.rpc("push_check_token", { p_token: token }) : { data: false };
  if (!valid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await admin.rpc("push_claim_pending");
  if (error) return NextResponse.json({ error: error.code }, { status: 500 });

  const byUser = new Map<string, Pending[]>();
  for (const n of (data ?? []) as Pending[]) byUser.set(n.user_id, [...(byUser.get(n.user_id) ?? []), n]);

  const messages: { userId: string; payload: PushPayload }[] = [];
  for (const [userId, items] of byUser) {
    if (items.length > MAX_INDIVIDUAL) {
      messages.push({ userId, payload: { title: `${items.length} novos lembretes`, body: items.slice(0, 3).map((i) => i.title).join("\n"), href: "/inicio", tag: "resumo" } });
    } else {
      for (const n of items) messages.push({ userId, payload: { title: n.title, body: n.body, href: n.href, tag: n.id } });
    }
  }
  return NextResponse.json(await sendPush(messages));
}
