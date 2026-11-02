import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayLocal } from "@/domain/shared/dates";
import { formatBRL } from "@/domain/shared/money";

export const maxDuration = 60;

type Due = { organization_id: string; scope: "empresa" | "pessoal"; owner_user_id: string | null; amount_cents: number; description: string };

/**
 * Contas a pagar que vencem hoje → central de notificações (Vercel Cron, CRON_SECRET).
 * Empresa: quem lê o financeiro da empresa. Pessoal: só o dono. Uma notificação por dia (dedupe).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.SUPABASE_SECRET_KEY) return NextResponse.json({ skipped: "not_configured" });

  const admin = createAdminClient();
  const today = todayLocal();
  const { data, error } = await admin
    .from("financial_transactions")
    .select("organization_id, scope, owner_user_id, amount_cents, description")
    .is("deleted_at", null)
    .eq("kind", "despesa")
    .eq("status", "previsto")
    .eq("due_date", today)
    .limit(5000);
  if (error) return NextResponse.json({ error: error.code }, { status: 500 });

  // Agrupa por organização + contexto (+ dono, no pessoal).
  const groups = new Map<string, Due[]>();
  for (const t of (data ?? []) as Due[]) {
    const key = `${t.organization_id}|${t.scope}|${t.owner_user_id ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  let sent = 0;
  for (const [key, items] of groups) {
    const [org, scope, owner] = key.split("|");
    const total = items.reduce((s, t) => s + Number(t.amount_cents), 0);
    const title = `${items.length} conta(s) ${scope === "empresa" ? "da empresa" : "pessoais"} vencem hoje: ${formatBRL(total)}`;
    const body = items
      .slice(0, 5)
      .map((t) => `${t.description} (${formatBRL(Number(t.amount_cents))})`)
      .join(", ")
      .concat(items.length > 5 ? ` e mais ${items.length - 5}` : "");
    const href = `/financeiro/${scope}/lancamentos`;
    const dedupe = `fin_due:${scope}:${today}`;
    if (scope === "empresa") {
      const { data: n } = await admin.rpc("notify_users", { p_org: org, p_perm: "finance.company.read", p_kind: "conta_vence_hoje", p_title: title, p_body: body, p_href: href, p_key: dedupe });
      sent += Number(n ?? 0);
    } else if (owner) {
      const { error: e } = await admin
        .from("notifications")
        .upsert({ organization_id: org, user_id: owner, kind: "conta_vence_hoje", title: title.slice(0, 200), body: body.slice(0, 1000), href, dedupe_key: dedupe }, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
      if (!e) sent++;
    }
  }
  return NextResponse.json({ due: data?.length ?? 0, notified: sent });
}
