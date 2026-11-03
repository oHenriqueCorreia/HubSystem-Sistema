import "server-only";
import { createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto";
import { SendBlocked, sendAutomated } from "@/lib/inbox-send";
import { runContentPublisher } from "@/lib/content-publisher";
import { runWhatsAppImports } from "@/lib/whatsapp-import";
import { inSendWindow } from "@/domain/crm/cadence";
import { todayLocal } from "@/domain/shared/dates";
import { actionSchema, conditionSchema, matchesCondition, type AutomationAction } from "@/domain/whatsapp/automations";
import { buildConversionEvent, conversionExpired } from "@/domain/whatsapp/conversions";
import { fillQuickReply } from "@/domain/whatsapp/quick-replies";
import { validWahaUrl } from "@/domain/whatsapp/waha";

// Horário comercial para envios automáticos: nada de mensagem de madrugada.
const SEND_WINDOW = { start: "08:00", end: "20:00", days: [1, 2, 3, 4, 5, 6] };
const CAMPAIGN_GAP_MS = 5000;
const JOB_BUDGET_MS = 55_000;
const MAX_CONSECUTIVE_ERRORS = 5;
const OPT_OUT_LINE = "\n\nPara não receber mais mensagens, responda SAIR.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (e: unknown) => String((e as { detail?: string }).detail ?? (e as Error).message ?? "falha").slice(0, 300);

type HubEvent = { id: number; organization_id: string; kind: string; conversation_id: string | null; lead_id: string | null; deal_id: string | null; payload: Record<string, unknown>; created_at: string };

async function firstActiveNumber(organizationId: string) {
  const { data } = await createAdminClient().from("whatsapp_numbers").select("id").eq("organization_id", organizationId).eq("status", "ativo").order("created_at").limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

// --- Automações -------------------------------------------------------------------

async function runAction(action: AutomationAction, ctx: { runId: string; index: number; event: HubEvent; conv: ConvCtx | null }) {
  const admin = createAdminClient();
  const { event, conv } = ctx;
  const leadId = event.lead_id ?? conv?.lead_id ?? null;
  const href = conv ? `/atendimento?conversa=${conv.id}` : leadId ? `/crm/leads/${leadId}` : "/atendimento";

  if (action.type === "atribuir") {
    const { data: assignee } = await admin.from("profiles").select("id").eq("id", action.userId).eq("organization_id", event.organization_id).eq("is_active", true).maybeSingle();
    if (!assignee) throw new SendBlocked("responsável não pertence à organização");
    if (conv) await admin.from("conversations").update({ assignee_id: action.userId }).eq("id", conv.id).eq("organization_id", event.organization_id);
    return;
  }
  if (action.type === "etiquetar") {
    const { data: tag } = await admin.from("tags").select("id").eq("id", action.tagId).eq("organization_id", event.organization_id).maybeSingle();
    if (!tag) throw new SendBlocked("etiqueta não pertence à organização");
    if (conv) await admin.from("conversation_tags").upsert({ conversation_id: conv.id, tag_id: action.tagId }, { onConflict: "conversation_id,tag_id", ignoreDuplicates: true });
    if (leadId) await admin.from("lead_tags").upsert({ lead_id: leadId, tag_id: action.tagId }, { onConflict: "lead_id,tag_id", ignoreDuplicates: true });
    return;
  }
  if (action.type === "criar_tarefa") {
    const due = new Date(Date.now() + action.dueHours * 3600_000).toISOString();
    const { data: lead } = leadId ? await admin.from("leads").select("owner_id").eq("id", leadId).maybeSingle() : { data: null };
    const { error } = await admin.from("tasks").insert({ organization_id: event.organization_id, title: action.title, lead_id: leadId, owner_id: conv?.assignee_id ?? lead?.owner_id ?? null, due_at: due, has_time: true });
    if (error) throw new Error(error.message);
    return;
  }
  if (action.type === "notificar") {
    await admin.rpc("notify_users", { p_org: event.organization_id, p_perm: "inbox.manage", p_kind: "automacao", p_title: action.title, p_body: null, p_href: href, p_key: `automacao:${ctx.runId}:${ctx.index}` });
    return;
  }
  // enviar_texto
  const { data: lead } = leadId ? await admin.from("leads").select("name, company_name, whatsapp_e164, phone_e164").eq("id", leadId).maybeSingle() : { data: null };
  const phone = conv?.contact_e164 ?? lead?.whatsapp_e164 ?? lead?.phone_e164;
  if (!phone) throw new SendBlocked("contato sem telefone");
  const numberId = conv?.number_id ?? (await firstActiveNumber(event.organization_id));
  if (!numberId) throw new SendBlocked("nenhum número de WhatsApp conectado");
  const name = lead?.name ?? conv?.contact_name ?? "";
  await sendAutomated({
    organizationId: event.organization_id,
    numberId,
    phone,
    leadId,
    contactName: name,
    // Uma mensagem por execução e por ação: o id é derivado do id da execução.
    clientRef: ctx.runId.slice(0, -2) + String(ctx.index).padStart(2, "0"),
    body: fillQuickReply(action.body, { name, company: lead?.company_name }),
    // Quem escreveu primeiro já está em conversa; os demais precisam ter autorizado.
    requireConsent: !conv?.last_inbound_at,
  });
}

type ConvCtx = { id: string; number_id: string; contact_e164: string; contact_name: string; lead_id: string | null; assignee_id: string | null; last_inbound_at: string | null };

async function runAutomations(deadline: number) {
  const admin = createAdminClient();
  while (Date.now() + 35_000 < deadline) {
    const { data: claimed, error: claimError } = await admin.rpc("inbox_jobs_claim_runs", { p_limit: 1 });
    if (claimError) throw claimError;
    if (!claimed?.length) break;
    for (const run of (claimed ?? []) as { id: string; automation_id: string; event_id: number }[]) {
      let status: "feito" | "bloqueado" | "erro" = "feito";
      let detail: string | null = null;
      try {
        const [{ data: automation }, { data: event }] = await Promise.all([
          admin.from("automations").select("enabled, condition, actions").eq("id", run.automation_id).maybeSingle(),
          admin.from("hub_events").select("*").eq("id", run.event_id).maybeSingle(),
        ]);
        if (!automation?.enabled || !event) {
          detail = "automação desligada antes de rodar";
        } else {
          const e = event as HubEvent;
          const { data: conv } = e.conversation_id ? await admin.from("conversations").select("id, number_id, contact_e164, contact_name, lead_id, assignee_id, last_inbound_at").eq("id", e.conversation_id).maybeSingle() : { data: null };
          const condition = conditionSchema.safeParse(automation.condition);
          const matched = condition.success && matchesCondition(condition.data, { body: e.payload.body as string | null, stageId: e.payload.stage_id as string | null, assigneeId: conv?.assignee_id ?? null });
          if (!matched) {
            detail = "condição não atendida";
          } else {
            const actions = ((automation.actions as unknown[]) ?? []).map((a) => actionSchema.parse(a));
            if (actions.filter((a) => a.type === "enviar_texto").length > 1) throw new SendBlocked("automação com mais de um envio de mensagem");
            for (const [index, action] of actions.entries()) await runAction(action, { runId: run.id, index, event: e, conv: conv as ConvCtx | null });
          }
        }
      } catch (err) {
        status = err instanceof SendBlocked ? "bloqueado" : "erro";
        detail = short(err);
      }
      await admin.from("automation_runs").update({ status, detail }).eq("id", run.id);
    }
  }
}

// --- Webhooks de saída ------------------------------------------------------------

async function runWebhooks(deadline: number) {
  const admin = createAdminClient();
  while (Date.now() + 12_000 < deadline) {
    const { data: claimed, error: claimError } = await admin.rpc("inbox_jobs_claim_deliveries", { p_limit: 1 });
    if (claimError) throw claimError;
    if (!claimed?.length) break;
    for (const d of (claimed ?? []) as { id: string; endpoint_id: string; event_id: number; attempts: number }[]) {
      const [{ data: endpoint }, { data: event }] = await Promise.all([admin.from("webhook_endpoints").select("url, secret_enc, enabled").eq("id", d.endpoint_id).maybeSingle(), admin.from("hub_events").select("*").eq("id", d.event_id).maybeSingle()]);
      const url = endpoint?.enabled ? validWahaUrl(endpoint.url) && endpoint.url : null;
      let responseStatus: number | null = null;
      let delivered = false;
      if (url && event) {
        const e = event as HubEvent;
        const body = JSON.stringify({ id: e.id, evento: e.kind, criado_em: e.created_at, conversa_id: e.conversation_id, lead_id: e.lead_id, negocio_id: e.deal_id, dados: e.payload });
        try {
          const signature = createHmac("sha256", decrypt(endpoint!.secret_enc)).update(body, "utf8").digest("hex");
          const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${signature}`, "X-Hub-Event": e.kind }, body, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) });
          responseStatus = res.status;
          delivered = res.ok;
        } catch {
          responseStatus = null;
        }
      }
      const giveUp = !delivered && d.attempts >= 3;
      await admin
        .from("webhook_deliveries")
        .update({ status: delivered ? "entregue" : giveUp ? "erro" : "pendente", response_status: responseStatus, next_try_at: new Date(Date.now() + d.attempts * 5 * 60_000).toISOString() })
        .eq("id", d.id);
    }
  }
}

// --- Conversões para a Meta -------------------------------------------------------

async function runConversions(deadline: number) {
  const admin = createAdminClient();
  while (Date.now() + 17_000 < deadline) {
    const { data: claimed, error: claimError } = await admin.rpc("inbox_jobs_claim_conversions", { p_limit: 1 });
    if (claimError) throw claimError;
    if (!claimed?.length) break;
    for (const c of (claimed ?? []) as { id: string; organization_id: string; event_name: string; value_cents: number; contact_e164: string | null; ctwa_clid: string | null; provider: string | null; event_time: string; attempts: number }[]) {
      const finish = (status: "enviado" | "erro" | "ignorado" | "pendente", error: string | null) =>
        admin.from("conversion_events").update({ status, error, sent_at: status === "enviado" ? new Date().toISOString() : null }).eq("id", c.id);
      if (conversionExpired(c.event_time)) {
        await finish("ignorado", "Passou do prazo de 7 dias da Meta.");
        continue;
      }
      const { data: settings } = await admin.from("conversion_settings").select("enabled, dataset_id, waba_id, token_enc").eq("organization_id", c.organization_id).maybeSingle();
      if (!settings?.enabled) {
        await finish("ignorado", "Envio de conversões desligado.");
        continue;
      }
      const event = buildConversionEvent({ id: c.id, eventName: c.event_name, valueCents: Number(c.value_cents), contactE164: c.contact_e164, ctwaClid: c.ctwa_clid, provider: c.provider, eventTime: c.event_time }, settings.waba_id);
      if (!event) {
        await finish("ignorado", "Sem telefone nem clique de anúncio.");
        continue;
      }
      try {
        const version = process.env.META_GRAPH_VERSION || "v23.0";
        const res = await fetch(`https://graph.facebook.com/${version}/${settings.dataset_id}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${decrypt(settings.token_enc)}` },
          body: JSON.stringify({ data: [event] }),
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) {
          await finish("enviado", null);
        } else {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          await finish(c.attempts >= 3 ? "erro" : "pendente", (body?.error?.message ?? `Meta respondeu ${res.status}`).slice(0, 500));
        }
      } catch {
        await finish(c.attempts >= 3 ? "erro" : "pendente", "Falha de conexão com a Meta.");
      }
    }
  }
}

// --- Cobrança ---------------------------------------------------------------------

const clientName = (c: { legal_name: string | null; lead?: unknown }) => (c.legal_name || (Array.isArray(c.lead) ? c.lead[0]?.name : (c.lead as { name?: string } | null | undefined)?.name) || "").trim();

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const dateBr = (iso: string) => iso.split("-").reverse().join("/");
const addDays = (day: string, days: number) => new Date(new Date(`${day}T12:00:00-03:00`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

async function runBilling(deadline: number) {
  if (!inSendWindow(SEND_WINDOW) || Date.now() + 35_000 >= deadline) return;
  const admin = createAdminClient();
  const { data: orgs } = await admin.from("inbox_settings").select("organization_id, billing_days_before, billing_message").eq("billing_enabled", true);
  const today = todayLocal();
  for (const org of orgs ?? []) {
    const { data: due } = await admin
      .from("financial_transactions")
      .select("id, description, amount_cents, due_date, client:clients(organization_id, legal_name, billing_phone_e164, lead_id, lead:leads(name))")
      .eq("organization_id", org.organization_id)
      .eq("scope", "empresa")
      .eq("kind", "receita")
      .eq("status", "previsto")
      .is("deleted_at", null)
      .not("client_id", "is", null)
      .gte("due_date", today)
      .lte("due_date", addDays(today, org.billing_days_before))
      .limit(100);
    for (const t of due ?? []) {
      if (Date.now() + 35_000 >= deadline) return;
      // A reserva impede duas cobranças da mesma conta, mesmo com execuções simultâneas.
      const { error: taken } = await admin.from("billing_reminders").insert({ transaction_id: t.id, organization_id: org.organization_id, status: "processando" });
      if (taken) continue;
      const client = (Array.isArray(t.client) ? t.client[0] : t.client) as { organization_id: string; legal_name: string; billing_phone_e164: string | null; lead_id: string } | null;
      let status: "enviado" | "bloqueado" | "erro" = "enviado";
      let detail: string | null = null;
      try {
        if (!client || client.organization_id !== org.organization_id) throw new SendBlocked("cliente não pertence à organização");
        if (!client.billing_phone_e164) throw new SendBlocked("cliente sem telefone de cobrança");
        const numberId = await firstActiveNumber(org.organization_id);
        if (!numberId) throw new SendBlocked("nenhum número de WhatsApp conectado");
        const body = org.billing_message
          .replace(/\{nome\}/gi, clientName(client).split(/\s+/)[0] ?? "")
          .replace(/\{descricao\}/gi, t.description)
          .replace(/\{valor\}/gi, money(Number(t.amount_cents)))
          .replace(/\{vencimento\}/gi, dateBr(t.due_date));
        await sendAutomated({ organizationId: org.organization_id, numberId, phone: client.billing_phone_e164, leadId: client.lead_id, contactName: client.legal_name, clientRef: t.id, body, requireConsent: true });
      } catch (err) {
        status = err instanceof SendBlocked ? "bloqueado" : "erro";
        detail = short(err);
      }
      await admin.from("billing_reminders").update({ status, detail }).eq("transaction_id", t.id);
      return; // uma cobrança por rodada evita estourar o tempo da função e limita o ritmo
    }
  }
}

// --- Campanhas --------------------------------------------------------------------

async function runCampaigns(deadline: number) {
  if (!inSendWindow(SEND_WINDOW)) return;
  const admin = createAdminClient();
  const { data: campaigns } = await admin.from("campaigns").select("id, organization_id, number_id, name, body, template_name, template_language, template_param_count, created_by, scheduled_at").eq("status", "enviando").limit(10);
  const dayStart = new Date(`${todayLocal()}T00:00:00-03:00`).toISOString();
  for (const c of campaigns ?? []) {
    if (c.scheduled_at && new Date(c.scheduled_at).getTime() > Date.now()) continue;
    const { data: settings } = await admin.from("inbox_settings").select("campaign_daily_limit").eq("organization_id", c.organization_id).maybeSingle();
    const { count: sentToday } = await admin.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("organization_id", c.organization_id).eq("status", "enviado").gte("sent_at", dayStart);
    let remaining = (settings?.campaign_daily_limit ?? 200) - (sentToday ?? 0);
    let errors = 0;
    while (remaining > 0 && Date.now() + 35_000 < deadline) {
      const { data: next, error: claimError } = await admin.rpc("campaign_claim_next", { p_campaign: c.id });
      if (claimError) throw claimError;
      const item = ((next ?? []) as { id: string; lead_id: string }[])[0];
      if (!item) {
        await admin.from("campaigns").update({ status: "concluida" }).eq("id", c.id).eq("status", "enviando");
        await admin.rpc("notify_users", { p_org: c.organization_id, p_perm: "inbox.manage", p_kind: "campanha", p_title: `Campanha concluída: ${c.name}`, p_body: null, p_href: "/atendimento/campanhas", p_key: `campanha:${c.id}:fim` });
        break;
      }
      // Alguém pode ter pausado ou cancelado no meio do lote.
      const { data: current } = await admin.from("campaigns").select("status").eq("id", c.id).maybeSingle();
      if (current?.status !== "enviando") {
        await admin.from("campaign_recipients").update({ status: "pendente" }).eq("id", item.id);
        break;
      }
      const { data: lead } = await admin.from("leads").select("name, company_name, whatsapp_e164, phone_e164").eq("id", item.lead_id).maybeSingle();
      let status: "enviado" | "bloqueado" | "erro" = "enviado";
      let detail: string | null = null;
      try {
        const phone = lead?.whatsapp_e164 ?? lead?.phone_e164;
        if (!phone) throw new SendBlocked("contato sem telefone");
        const name = lead?.name ?? "";
        const first = name.trim().split(/\s+/)[0] || "cliente";
        const company = lead?.company_name?.trim() || "não informada";
        const body = c.template_name
          ? c.body.replace(/\{\{1\}\}/g, first).replace(/\{\{2\}\}/g, company)
          : fillQuickReply(c.body, { name, company: lead?.company_name }) + OPT_OUT_LINE;
        await sendAutomated({
          organizationId: c.organization_id,
          numberId: c.number_id,
          phone,
          leadId: item.lead_id,
          contactName: name,
          clientRef: item.id,
          body,
          requireConsent: true,
          template: c.template_name ? { name: c.template_name, language: c.template_language ?? "pt_BR", params: [first, company].slice(0, c.template_param_count ?? 0) } : null,
        });
        remaining--;
        errors = 0;
      } catch (err) {
        status = err instanceof SendBlocked ? "bloqueado" : "erro";
        detail = short(err);
        if (status === "erro") errors++;
      }
      await admin.from("campaign_recipients").update({ status, detail, sent_at: status === "enviado" ? new Date().toISOString() : null }).eq("id", item.id);
      // Erros seguidos podem indicar número bloqueado ou desconectado: para e avisa, em vez de insistir.
      if (errors >= MAX_CONSECUTIVE_ERRORS || detail === "o número de WhatsApp está desconectado") {
        await admin.from("campaigns").update({ status: "pausada" }).eq("id", c.id);
        await admin.rpc("notify_users", { p_org: c.organization_id, p_perm: "inbox.manage", p_kind: "campanha", p_title: `Campanha pausada: ${c.name}`, p_body: "Houve falhas seguidas no envio. Confira o número conectado antes de continuar.", p_href: "/atendimento/campanhas", p_key: `campanha:${c.id}:pausa:${todayLocal()}` });
        break;
      }
      if (status === "enviado") {
        const gap = CAMPAIGN_GAP_MS + Math.random() * 2000;
        if (Date.now() + gap + 35_000 >= deadline) break;
        await sleep(gap);
      }
    }
  }
}

/** Uma rodada. Cada parte é isolada: a falha de uma não impede as outras. */
export async function runInboxJobs() {
  const started = Date.now();
  const deadline = started + JOB_BUDGET_MS;
  const admin = createAdminClient();
  const steps: [string, () => Promise<unknown>][] = [
    ["eventos", async () => {
      const { error } = await admin.rpc("inbox_jobs_claim", { p_limit: 200 });
      if (error) throw error;
    }],
    ["automacoes", () => runAutomations(deadline)],
    ["webhooks", () => runWebhooks(deadline)],
    ["conversoes", () => runConversions(deadline)],
    ["cobranca", () => runBilling(deadline)],
    ["publicacoes", runContentPublisher],
    ["historico", () => runWhatsAppImports(deadline)],
    ["campanhas", () => runCampaigns(deadline)],
  ];
  const failed: string[] = [];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch {
      console.error(`[inbox-jobs] falha em ${name}`);
      failed.push(name);
    }
  }
  return { failed };
}
