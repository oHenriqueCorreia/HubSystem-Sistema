import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

/** Exporta todos os dados de um titular (LGPD, art. 18). Somente admin.data_export. */
export async function GET(_req: Request, { params }: RouteContext<"/api/lgpd/leads/[id]">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  if (!user.permissions["admin.data_export"]) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });

  const supabase = await createClient();
  const [lead, activities, tasks, events, client, attachments] = await Promise.all([
    supabase.from("leads").select("*, lead_tags(tags(name))").eq("id", id).maybeSingle(),
    supabase.from("activities").select("type, content, occurred_at").eq("lead_id", id).order("occurred_at"),
    supabase.from("tasks").select("title, description, status, due_at, completed_at").eq("lead_id", id),
    supabase.from("calendar_events").select("title, starts_at, ends_at, location").eq("lead_id", id),
    supabase.from("clients").select("legal_name, document, billing_email, billing_phone_e164, converted_at, contracts(title, amount_cents, recurrence, start_date, end_date, status)").eq("lead_id", id).maybeSingle(),
    supabase.from("attachments").select("file_name, mime_type, size_bytes, created_at").eq("entity_type", "lead").eq("entity_id", id).is("deleted_at", null),
  ]);
  if (!lead.data) return NextResponse.json({ error: "Lead não encontrado." }, { status: 404 });

  const logged = await supabase.rpc("lgpd_log_export", { p_lead: id });
  if (logged.error) return NextResponse.json({ error: "Não foi possível registrar a exportação." }, { status: 500 });

  const body = {
    exportado_em: new Date().toISOString(),
    exportado_por: user.email,
    titular: lead.data,
    interacoes: activities.data ?? [],
    tarefas: tasks.data ?? [],
    eventos: events.data ?? [],
    cliente: client.data ?? null,
    anexos: attachments.data ?? [],
  };
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="dados-titular-${id}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
