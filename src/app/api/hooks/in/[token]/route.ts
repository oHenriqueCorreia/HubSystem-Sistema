import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { brPhoneVariants, normalizePhone } from "@/domain/shared/phone";

const MAX_BODY = 20_000;

const schema = z.object({
  nome: z.string().trim().min(1).max(160),
  telefone: z.string().trim().max(40).optional(),
  email: z.email().optional(),
  empresa: z.string().trim().max(160).optional(),
  observacoes: z.string().trim().max(2000).optional(),
  origem: z.string().trim().max(80).optional(),
  // Autorização só vale quando o sistema de origem afirma que o contato aceitou.
  autorizou_whatsapp: z.literal(true).optional(),
});

/** Recebe contatos de outros sistemas (formulário, site, Zapier). O endereço é o segredo: só o hash fica no banco. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) return new NextResponse(null, { status: 404 });
  const admin = createAdminClient();
  const { data: hook } = await admin.from("inbound_hooks").select("id, organization_id, pipeline_id, owner_id, enabled").eq("token_hash", createHash("sha256").update(token).digest("hex")).maybeSingle();
  if (!hook?.enabled) return new NextResponse(null, { status: 404 });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "payload_grande" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "json_invalido" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "dados_invalidos", campos: parsed.error.issues.map((i) => i.path.join(".")) }, { status: 422 });
  const input = parsed.data;
  const phone = input.telefone ? normalizePhone(input.telefone) : null;
  if (!phone && !input.email) return NextResponse.json({ error: "informe_telefone_ou_email" }, { status: 422 });

  await admin.from("inbound_hooks").update({ last_used_at: new Date().toISOString() }).eq("id", hook.id);

  // Sem duplicar: contato que já existe só ganha o registro na linha do tempo.
  let existing = null as { id: string } | null;
  if (phone) {
    const variants = brPhoneVariants(phone.e164);
    existing = (await admin.from("leads").select("id").eq("organization_id", hook.organization_id).is("deleted_at", null).or(variants.map((v) => `phone_e164.eq.${v},whatsapp_e164.eq.${v}`).join(",")).limit(1).maybeSingle()).data;
  }
  if (!existing && input.email) {
    existing = (await admin.from("leads").select("id").eq("organization_id", hook.organization_id).is("deleted_at", null).eq("email", input.email.toLowerCase()).limit(1).maybeSingle()).data;
  }
  if (existing) {
    await admin.from("activities").insert({ organization_id: hook.organization_id, lead_id: existing.id, type: "sistema", content: `Novo contato recebido por integração${input.origem ? ` (${input.origem})` : ""}`, metadata: { origem: "automatica" }, created_by: null });
    return NextResponse.json({ id: existing.id, criado: false });
  }

  const { data: lead, error } = await admin
    .from("leads")
    .insert({
      organization_id: hook.organization_id,
      name: input.nome,
      company_name: input.empresa ?? null,
      email: input.email?.toLowerCase() ?? null,
      phone_e164: phone?.e164 ?? null,
      whatsapp_e164: phone?.type !== "fixo" ? (phone?.e164 ?? null) : null,
      source: input.origem ?? "Integração",
      notes: input.observacoes ?? null,
      owner_id: hook.owner_id,
      whatsapp_consent_at: input.autorizou_whatsapp ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error || !lead) {
    console.error("[hook-entrada] falha ao criar lead", error?.code);
    return NextResponse.json({ error: "falha_ao_criar" }, { status: 500 });
  }
  if (hook.pipeline_id) {
    const { data: stage } = await admin.from("stages").select("id").eq("pipeline_id", hook.pipeline_id).eq("kind", "open").is("archived_at", null).order("position").limit(1).maybeSingle();
    if (stage) await admin.from("deals").insert({ organization_id: hook.organization_id, lead_id: lead.id, pipeline_id: hook.pipeline_id, stage_id: stage.id, owner_id: hook.owner_id, position: Date.now() / 1000 });
  }
  await admin.from("activities").insert({ organization_id: hook.organization_id, lead_id: lead.id, type: "sistema", content: `Lead criado por integração${input.origem ? ` (${input.origem})` : ""}`, metadata: { origem: "automatica" }, created_by: null });
  return NextResponse.json({ id: lead.id, criado: true }, { status: 201 });
}
