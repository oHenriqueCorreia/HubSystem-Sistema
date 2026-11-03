import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTemplate, sendText, whatsappConfigured } from "@/lib/whatsapp";
import { inSendWindow } from "@/domain/crm/cadence";
import { todayLocal } from "@/domain/shared/dates";
import { brPhoneVariants } from "@/domain/shared/phone";
import { fillQuickReply } from "@/domain/whatsapp/quick-replies";

type Due = {
  task_id: string;
  organization_id: string;
  enrollment_id: string;
  lead_id: string;
  deal_id: string | null;
  owner_id: string | null;
  channel: string;
  whatsapp_template: string | null;
  template_language: string;
  add_tag_id: string | null;
  move_to_stage_id: string | null;
  send_window: { start: string; end: string; days: number[] };
  require_consent: boolean;
  daily_limit: number;
  lead_name: string;
  lead_company: string;
  lead_phone: string | null;
  consent_at: string | null;
  opt_out_at: string | null;
};

/** Reserva a tarefa: uma execução por tarefa; erro pode tentar de novo até 3 vezes. */
async function claim(d: Due) {
  const admin = createAdminClient();
  const ins = await admin.from("cadence_runs").insert({ organization_id: d.organization_id, enrollment_id: d.enrollment_id, task_id: d.task_id, status: "processando" }).select("id").maybeSingle();
  if (ins.data) return true;
  const { data: retry } = await admin
    .from("cadence_runs")
    .update({ status: "processando", updated_at: new Date().toISOString() })
    .eq("task_id", d.task_id)
    .eq("status", "erro")
    .lt("attempts", 3)
    .select("id, attempts")
    .maybeSingle();
  if (!retry) return false;
  await admin.from("cadence_runs").update({ attempts: retry.attempts + 1 }).eq("id", retry.id);
  return true;
}

async function finish(d: Due, status: "enviado" | "executado" | "bloqueado" | "erro", detail: string | null) {
  const admin = createAdminClient();
  await admin.from("cadence_runs").update({ status, detail: detail?.slice(0, 500) ?? null, updated_at: new Date().toISOString() }).eq("task_id", d.task_id);
  if (status === "enviado" || status === "executado") {
    await admin.from("tasks").update({ status: "concluida", outcome: status === "enviado" ? "Enviado automaticamente pela cadência." : "Ação automática executada." }).eq("id", d.task_id);
  }
  await admin.from("activities").insert({
    organization_id: d.organization_id,
    lead_id: d.lead_id,
    type: "sistema",
    content:
      status === "enviado"
        ? "Cadência: mensagem automática enviada"
        : status === "executado"
          ? "Cadência: ação automática executada"
          : status === "bloqueado"
            ? `Cadência: envio bloqueado (${detail})`
            : `Cadência: falha no envio (${detail})`,
    metadata: { task_id: d.task_id, enrollment_id: d.enrollment_id, origem: "automatica" },
    created_by: null,
  });
  if (status === "bloqueado" || status === "erro") {
    await admin.rpc("notify_users", {
      p_org: d.organization_id,
      p_perm: "crm.cadences.manage",
      p_kind: "cadencia_falha",
      p_title: status === "erro" ? `Falha na cadência de ${d.lead_name}` : `Cadência bloqueada para ${d.lead_name}`,
      p_body: detail,
      p_href: `/crm/leads/${d.lead_id}`,
      p_key: `cadencia:${d.task_id}:${status}`,
    });
  }
}

async function sendWhatsApp(d: Due) {
  const admin = createAdminClient();
  const { data: number } = await admin.from("whatsapp_numbers").select("id, provider").eq("organization_id", d.organization_id).eq("status", "ativo").order("created_at").limit(1).maybeSingle();
  if (!number) throw Object.assign(new Error("numero"), { reason: "Nenhum número de WhatsApp conectado" });
  const qr = number.provider === "waha";
  if (!qr && !whatsappConfigured()) throw Object.assign(new Error("config"), { reason: "WhatsApp não configurado no servidor" });
  // QR Code não tem modelos da Meta: o passo aponta para o atalho de uma resposta rápida.
  const { data: reply } = qr ? await admin.from("quick_replies").select("body").eq("organization_id", d.organization_id).eq("shortcut", d.whatsapp_template).maybeSingle() : { data: null };
  if (qr && !reply) throw Object.assign(new Error("resposta"), { reason: `Crie uma resposta rápida com o atalho "${d.whatsapp_template}" para usar no QR Code`, blocked: true });
  const { data: tpl } = qr
    ? { data: null }
    : await admin.from("whatsapp_templates").select("name, language, status, components").eq("organization_id", d.organization_id).eq("name", d.whatsapp_template).eq("language", d.template_language).maybeSingle();
  if (!qr && (!tpl || tpl.status !== "APPROVED")) throw Object.assign(new Error("modelo"), { reason: "Modelo não encontrado ou não aprovado", blocked: true });
  const body = tpl ? (((tpl.components as { type: string; text?: string }[]).find((c) => c.type === "BODY")?.text ?? "") as string) : "";
  const text = reply ? fillQuickReply(reply.body as string, { name: d.lead_name, company: d.lead_company }) : "";
  const count = new Set(body.match(/\{\{\d+\}\}/g) ?? []).size;
  // Variáveis na ordem: {{1}} primeiro nome, {{2}} empresa.
  const values = [d.lead_name.split(" ")[0] || d.lead_name, d.lead_company];
  const params = Array.from({ length: count }, (_, i) => values[i] ?? d.lead_name);

  const phone = d.lead_phone!;
  const { data: existing } = await admin.from("conversations").select("id").eq("number_id", number.id).in("contact_e164", brPhoneVariants(phone)).limit(1).maybeSingle();
  const conversationId =
    existing?.id ??
    (
      await admin
        .from("conversations")
        .insert({ organization_id: d.organization_id, number_id: number.id, contact_e164: phone, contact_name: d.lead_name.slice(0, 120), lead_id: d.lead_id, assignee_id: d.owner_id })
        .select("id")
        .single()
    ).data!.id;

  // client_ref = id da tarefa: mesmo que o processo caia e rode de novo, não duplica a mensagem.
  const { data: dup } = await admin.from("messages").select("id").eq("client_ref", d.task_id).maybeSingle();
  if (dup) return;
  const wamid = tpl ? await sendTemplate(number.id, phone, tpl.name, tpl.language, params) : await sendText(number.id, phone, text);
  await admin.from("messages").insert({
    organization_id: d.organization_id,
    conversation_id: conversationId,
    direction: "saida",
    wamid,
    client_ref: d.task_id,
    type: tpl ? "template" : "text",
    body: tpl ? body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? "") || tpl.name : text,
    status: "enviada",
  });
  await admin.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversationId);
}

/** Processa as etapas automáticas vencidas (todas as organizações ou uma só). */
export async function runCadences(organizationId?: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("due_cadence_actions", { p_limit: 300 });
  if (error) throw error;
  const due = ((data ?? []) as Due[]).filter((d) => !organizationId || d.organization_id === organizationId);
  const sentToday = new Map<string, number>();
  const counts = { enviados: 0, executados: 0, bloqueados: 0, erros: 0, aguardando: 0 };
  const dayStart = new Date(`${todayLocal()}T00:00:00-03:00`).toISOString();

  for (const d of due) {
    // Fora da janela: fica para a próxima rodada (não conta como execução).
    if (d.channel === "whatsapp" && !inSendWindow(d.send_window)) {
      counts.aguardando++;
      continue;
    }
    if (d.channel === "whatsapp") {
      if (!sentToday.has(d.organization_id)) {
        const { count } = await admin.from("cadence_runs").select("id", { count: "exact", head: true }).eq("organization_id", d.organization_id).eq("status", "enviado").gte("created_at", dayStart);
        sentToday.set(d.organization_id, count ?? 0);
      }
      if ((sentToday.get(d.organization_id) ?? 0) >= d.daily_limit) {
        counts.aguardando++;
        continue;
      }
    }
    if (!(await claim(d))) continue;

    try {
      if (d.channel === "whatsapp" && d.whatsapp_template) {
        if (d.opt_out_at) throw Object.assign(new Error("optout"), { reason: "o contato pediu para não receber mensagens", blocked: true });
        if (d.require_consent && !d.consent_at) throw Object.assign(new Error("consent"), { reason: "sem consentimento registrado", blocked: true });
        if (!d.lead_phone) throw Object.assign(new Error("phone"), { reason: "lead sem telefone", blocked: true });
        await sendWhatsApp(d);
        sentToday.set(d.organization_id, (sentToday.get(d.organization_id) ?? 0) + 1);
      }
      if (d.add_tag_id) await admin.from("lead_tags").upsert({ lead_id: d.lead_id, tag_id: d.add_tag_id }, { onConflict: "lead_id,tag_id", ignoreDuplicates: true });
      if (d.move_to_stage_id && d.deal_id) {
        await admin.from("deals").update({ stage_id: d.move_to_stage_id, stage_changed_at: new Date().toISOString() }).eq("id", d.deal_id);
      }
      const sent = d.channel === "whatsapp" && Boolean(d.whatsapp_template);
      await finish(d, sent ? "enviado" : "executado", null);
      if (sent) counts.enviados++;
      else counts.executados++;
    } catch (e) {
      const err = e as { reason?: string; blocked?: boolean; detail?: string };
      if (err.blocked) {
        await finish(d, "bloqueado", err.reason ?? "bloqueado");
        counts.bloqueados++;
      } else {
        await finish(d, "erro", err.reason ?? err.detail ?? "falha no envio");
        counts.erros++;
      }
    }
  }
  return counts;
}
