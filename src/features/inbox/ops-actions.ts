"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { publicEnv } from "@/lib/env";
import { fail, ok } from "@/domain/shared/result";
import { actionSchema, conditionSchema, TRIGGER_KEYS } from "@/domain/whatsapp/automations";
import { validWahaUrl } from "@/domain/whatsapp/waha";

const AJUSTES = "/atendimento/ajustes";

// --- Respostas rápidas ------------------------------------------------------------

export const saveQuickReply = defineAction(
  {
    schema: z.object({
      id: z.uuid().optional(),
      shortcut: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,30}$/, "Use só letras sem acento, números, - ou _, sem espaços."),
      body: z.string().trim().min(1, "Escreva o texto.").max(4096),
    }),
    permission: "inbox.manage",
  },
  async (input) => {
    const supabase = await createClient();
    const row = { shortcut: input.shortcut, body: input.body };
    const { error } = input.id ? await supabase.from("quick_replies").update(row).eq("id", input.id) : await supabase.from("quick_replies").insert(row);
    if (error?.code === "23505") return fail("conflict", "Já existe uma resposta com este atalho.");
    if (error) throw error;
    revalidatePath(AJUSTES);
    return ok(null, "Resposta rápida salva.");
  },
);

export const deleteQuickReply = defineAction({ schema: z.object({ id: z.uuid() }), permission: "inbox.manage" }, async ({ id }) => {
  const supabase = await createClient();
  must(await supabase.from("quick_replies").delete().eq("id", id));
  revalidatePath(AJUSTES);
  return ok(null, "Resposta rápida apagada.");
});

// --- Radar, limites e cobrança -----------------------------------------------------

export const saveInboxSettings = defineAction(
  {
    schema: z.object({
      radarClientMinutes: z.number().int().min(5, "Use pelo menos 5 minutos.").max(10080),
      radarContactHours: z.number().int().min(1, "Use pelo menos 1 hora.").max(720),
      radarNotify: z.boolean(),
      campaignDailyLimit: z.number().int().min(1).max(2000),
      billingEnabled: z.boolean(),
      billingDaysBefore: z.number().int().min(0).max(30),
      billingMessage: z.string().trim().min(10, "Escreva a mensagem de cobrança.").max(1000),
    }),
    permission: "inbox.manage",
  },
  async (input, { user }) => {
    const supabase = await createClient();
    must(
      await supabase.from("inbox_settings").upsert(
        {
          organization_id: user.organizationId,
          radar_client_minutes: input.radarClientMinutes,
          radar_contact_hours: input.radarContactHours,
          radar_notify: input.radarNotify,
          campaign_daily_limit: input.campaignDailyLimit,
          billing_enabled: input.billingEnabled,
          billing_days_before: input.billingDaysBefore,
          billing_message: input.billingMessage,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id" },
      ),
    );
    revalidatePath(AJUSTES);
    revalidatePath("/atendimento/radar");
    return ok(null, "Ajustes salvos.");
  },
);

// --- Conversões para a Meta --------------------------------------------------------

export const saveConversionSettings = defineAction(
  {
    schema: z.object({
      enabled: z.boolean(),
      datasetId: z.string().trim().regex(/^\d{5,30}$/, "Informe o ID do conjunto de dados (só dígitos)."),
      wabaId: z.union([z.literal(""), z.string().trim().regex(/^\d{5,30}$/, "O ID da conta do WhatsApp Business tem só dígitos.")]).default(""),
      token: z.string().trim().max(1000).default(""),
    }),
    permission: "inbox.manage",
  },
  async (input, { user }) => {
    const admin = createAdminClient();
    const { data: current } = await admin.from("conversion_settings").select("token_enc").eq("organization_id", user.organizationId).maybeSingle();
    if (!current && input.token.length < 50) return fail("validation", "Cole o token de acesso da Conversions API.");
    must(
      await admin.from("conversion_settings").upsert(
        {
          organization_id: user.organizationId,
          enabled: input.enabled,
          dataset_id: input.datasetId,
          waba_id: input.wabaId || null,
          token_enc: input.token ? encrypt(input.token) : current!.token_enc,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id" },
      ),
    );
    revalidatePath(AJUSTES);
    return ok(null, input.enabled ? "Envio de vendas para a Meta ligado." : "Dados salvos. O envio está desligado.");
  },
);

// --- Webhooks ----------------------------------------------------------------------

export const createWebhookEndpoint = defineAction(
  {
    schema: z.object({
      name: z.string().trim().min(2, "Dê um nome.").max(120),
      url: z.string().trim().max(500),
      events: z.array(z.enum(TRIGGER_KEYS)).min(1, "Escolha ao menos um evento."),
    }),
    permission: "inbox.manage",
  },
  async (input, { user }) => {
    const origin = validWahaUrl(input.url);
    if (!origin) return fail("validation", "Use um endereço público começando com https://.");
    const secret = randomBytes(32).toString("hex");
    must(await createAdminClient().from("webhook_endpoints").insert({ organization_id: user.organizationId, name: input.name, url: input.url, secret_enc: encrypt(secret), events: input.events }));
    revalidatePath(AJUSTES);
    return ok({ secret }, "Webhook criado.");
  },
);

export const deleteWebhookEndpoint = defineAction({ schema: z.object({ id: z.uuid() }), permission: "inbox.manage" }, async ({ id }, { user }) => {
  must(await createAdminClient().from("webhook_endpoints").delete().eq("id", id).eq("organization_id", user.organizationId));
  revalidatePath(AJUSTES);
  return ok(null, "Webhook apagado.");
});

export const createInboundHook = defineAction(
  { schema: z.object({ name: z.string().trim().min(2, "Dê um nome.").max(120), pipelineId: z.uuid().nullable() }), permission: "inbox.manage" },
  async (input, { user }) => {
    const admin = createAdminClient();
    if (input.pipelineId) {
      const { data: pipeline } = await admin.from("pipelines").select("id").eq("id", input.pipelineId).eq("organization_id", user.organizationId).maybeSingle();
      if (!pipeline) return fail("validation", "Funil não encontrado nesta organização.");
    }
    const token = randomBytes(32).toString("base64url");
    must(await admin.from("inbound_hooks").insert({ organization_id: user.organizationId, name: input.name, pipeline_id: input.pipelineId, owner_id: user.id, token_hash: createHash("sha256").update(token).digest("hex") }));
    revalidatePath(AJUSTES);
    return ok({ url: `${publicEnv.NEXT_PUBLIC_SITE_URL}/api/hooks/in/${token}` }, "Entrada criada.");
  },
);

export const deleteInboundHook = defineAction({ schema: z.object({ id: z.uuid() }), permission: "inbox.manage" }, async ({ id }, { user }) => {
  must(await createAdminClient().from("inbound_hooks").delete().eq("id", id).eq("organization_id", user.organizationId));
  revalidatePath(AJUSTES);
  return ok(null, "Entrada apagada. O endereço parou de funcionar.");
});

// --- Automações --------------------------------------------------------------------

export const saveAutomation = defineAction(
  {
    schema: z.object({
      id: z.uuid().optional(),
      name: z.string().trim().min(2, "Dê um nome à automação.").max(120),
      trigger: z.enum(TRIGGER_KEYS),
      condition: conditionSchema,
      actions: z.array(actionSchema).min(1, "Escolha ao menos uma ação.").max(5),
      delayMinutes: z.number().int().min(0).max(43200),
    }),
    permission: "inbox.manage",
  },
  async (input, { user }) => {
    if (input.actions.filter((a) => a.type === "enviar_texto").length > 1) {
      return fail("validation", "Use no máximo uma ação de envio de mensagem por automação.");
    }
    const admin = createAdminClient();
    const assignees = [...new Set(input.actions.filter((a) => a.type === "atribuir").map((a) => a.userId))];
    const tags = [...new Set(input.actions.filter((a) => a.type === "etiquetar").map((a) => a.tagId))];
    const [usersResult, tagsResult, stageResult] = await Promise.all([
      assignees.length ? admin.from("profiles").select("id").eq("organization_id", user.organizationId).eq("is_active", true).in("id", assignees) : Promise.resolve({ data: [] }),
      tags.length ? admin.from("tags").select("id").eq("organization_id", user.organizationId).in("id", tags) : Promise.resolve({ data: [] }),
      input.condition.stageId ? admin.from("stages").select("id").eq("id", input.condition.stageId).eq("organization_id", user.organizationId).maybeSingle() : Promise.resolve({ data: { id: "" } }),
    ]);
    if ((usersResult.data?.length ?? 0) !== assignees.length || (tagsResult.data?.length ?? 0) !== tags.length || !stageResult.data) {
      return fail("validation", "Responsável, etiqueta ou etapa não pertence a esta organização.");
    }
    const supabase = await createClient();
    const row = { name: input.name, trigger: input.trigger, condition: input.condition, actions: input.actions, delay_minutes: input.delayMinutes };
    must(input.id ? await supabase.from("automations").update(row).eq("id", input.id) : await supabase.from("automations").insert(row));
    revalidatePath("/atendimento/automacoes");
    return ok(null, "Automação salva.");
  },
);

export const toggleAutomation = defineAction({ schema: z.object({ id: z.uuid(), enabled: z.boolean() }), permission: "inbox.manage" }, async ({ id, enabled }) => {
  const supabase = await createClient();
  must(await supabase.from("automations").update({ enabled }).eq("id", id));
  revalidatePath("/atendimento/automacoes");
  return ok(null, enabled ? "Automação ligada." : "Automação desligada.");
});

export const deleteAutomation = defineAction({ schema: z.object({ id: z.uuid() }), permission: "inbox.manage" }, async ({ id }) => {
  const supabase = await createClient();
  must(await supabase.from("automations").delete().eq("id", id));
  revalidatePath("/atendimento/automacoes");
  return ok(null, "Automação apagada.");
});

// --- Campanhas ---------------------------------------------------------------------

const MAX_AUDIENCE = 5000;
const audienceSchema = z.object({ tagId: z.uuid().nullable(), stageId: z.uuid().nullable() });

/** Só entra quem autorizou, não pediu para sair e tem telefone. O envio confere de novo na hora. */
async function findAudience(filter: z.infer<typeof audienceSchema>) {
  const supabase = await createClient();
  const joins = [filter.tagId ? "lead_tags!inner(tag_id)" : "", filter.stageId ? "deals!inner(stage_id)" : ""].filter(Boolean).join(", ");
  const ids = new Set<string>();
  const batchSize = 1000;
  for (let offset = 0; offset < MAX_AUDIENCE; offset += batchSize) {
    let q = supabase.from("leads").select(joins ? `id, ${joins}` : "id").is("deleted_at", null).not("whatsapp_consent_at", "is", null).is("contact_opt_out_at", null).or("whatsapp_e164.not.is.null,phone_e164.not.is.null").order("id").range(offset, offset + batchSize - 1);
    if (filter.tagId) q = q.eq("lead_tags.tag_id", filter.tagId);
    if (filter.stageId) q = q.eq("deals.stage_id", filter.stageId);
    const { data, error } = await q;
    if (error) throw error;
    for (const lead of (data ?? []) as unknown as { id: string }[]) ids.add(lead.id);
    if ((data?.length ?? 0) < batchSize) break;
  }
  return [...ids];
}

export const previewAudience = defineAction({ schema: audienceSchema, permission: "inbox.manage" }, async (input) => ok({ count: (await findAudience(input)).length }));

export const createCampaign = defineAction(
  {
    schema: audienceSchema.extend({
      name: z.string().trim().min(2, "Dê um nome à campanha.").max(120),
      numberId: z.uuid("Escolha o número."),
      body: z.string().trim().min(1, "Escreva a mensagem.").max(4000),
      templateId: z.uuid().nullable(),
      scheduledAt: z.iso.datetime({ offset: true }).nullable(),
    }),
    permission: "inbox.manage",
  },
  async (input) => {
    const supabase = await createClient();
    const { data: numbers } = await supabase.rpc("my_whatsapp_numbers");
    const number = ((numbers ?? []) as { id: string; provider: string }[]).find((n) => n.id === input.numberId);
    if (!number) return fail("not_found", "Número não encontrado.");
    let template: { name: string; language: string; body: string; params: number } | null = null;
    if (number.provider === "cloud") {
      const { data: channel } = await createAdminClient().from("whatsapp_numbers").select("waba_id").eq("id", input.numberId).maybeSingle();
      const { data } = input.templateId ? await supabase.from("whatsapp_templates").select("waba_id, name, language, status, components").eq("id", input.templateId).maybeSingle() : { data: null };
      if (!data || data.status !== "APPROVED") return fail("validation", "Na API oficial, campanha precisa de um modelo aprovado pela Meta.");
      if (!channel?.waba_id || data.waba_id !== channel.waba_id) return fail("validation", "Escolha um modelo aprovado para este número.");
      const components = data.components as { type: string; text?: string }[];
      const body = components.find((c) => c.type === "BODY")?.text ?? "";
      const params = Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
      if (!body || params > 2 || components.some((c) => c.type === "HEADER" && /\{\{\d+\}\}/.test(c.text ?? ""))) {
        return fail("validation", "Esta campanha aceita modelos de texto com até duas variáveis no corpo: primeiro nome e empresa.");
      }
      template = { name: data.name, language: data.language, body, params };
    }
    const audience = await findAudience({ tagId: input.tagId, stageId: input.stageId });
    if (!audience.length) return fail("business_rule", "Nenhum contato com autorização nestes filtros.");
    const campaign = must(
      await supabase
        .from("campaigns")
        .insert({ name: input.name, number_id: input.numberId, body: template?.body ?? input.body, template_name: template?.name ?? null, template_language: template?.language ?? null, template_param_count: template?.params ?? 0, scheduled_at: input.scheduledAt })
        .select("id")
        .single(),
    ) as { id: string };
    try {
      for (let i = 0; i < audience.length; i += 500) {
        must(await supabase.from("campaign_recipients").insert(audience.slice(i, i + 500).map((lead_id) => ({ campaign_id: campaign.id, lead_id }))));
      }
    } catch (error) {
      // O rascunho só pode aparecer quando toda a lista foi gravada.
      await supabase.from("campaigns").delete().eq("id", campaign.id).eq("status", "rascunho");
      throw error;
    }
    revalidatePath("/atendimento/campanhas");
    return ok({ id: campaign.id, count: audience.length }, `Campanha criada com ${audience.length} contato(s). Revise e clique em Iniciar.`);
  },
);

const NEXT_STATUS = { iniciar: { from: ["rascunho", "pausada"], to: "enviando", message: "Campanha iniciada." }, pausar: { from: ["enviando"], to: "pausada", message: "Campanha pausada." }, cancelar: { from: ["rascunho", "enviando", "pausada"], to: "cancelada", message: "Campanha cancelada." } } as const;

export const setCampaignStatus = defineAction({ schema: z.object({ id: z.uuid(), action: z.enum(["iniciar", "pausar", "cancelar"]) }), permission: "inbox.manage" }, async ({ id, action }) => {
  const supabase = await createClient();
  const step = NEXT_STATUS[action];
  const res = must(await supabase.from("campaigns").update({ status: step.to }).eq("id", id).in("status", [...step.from]).select("id")) as { id: string }[];
  if (!res.length) return fail("conflict", "A campanha mudou de situação. Atualize a página.");
  revalidatePath("/atendimento/campanhas");
  return ok(null, step.message);
});
