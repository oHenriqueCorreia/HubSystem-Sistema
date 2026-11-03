"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, encrypt } from "@/lib/crypto";
import { fail, ok } from "@/domain/shared/result";
import { brPhoneVariants } from "@/domain/shared/phone";
import { RATE_LIMIT_MESSAGE, withinRateLimit } from "@/lib/rate-limit";
import { baseMime, checkOutgoingMedia, isOutgoingPath, outgoingPath } from "@/domain/whatsapp/media";
import { wahaDeleteSession } from "@/lib/waha";
import { fetchTemplates, markRead, numberInfo, numberProvider, sendMedia, sendTemplate, sendText, whatsappConfigured } from "@/lib/whatsapp";

const NOT_CONFIGURED = "O WhatsApp ainda não foi configurado no servidor (META_APP_SECRET e WHATSAPP_VERIFY_TOKEN).";
const WINDOW_MS = 24 * 3600_000;
const QR_OFFLINE = "O WhatsApp por QR Code está desconectado. Reconecte o número para enviar.";
const OUTSIDE_WINDOW = "Passaram mais de 24 horas desde a última mensagem do cliente. Envie um modelo aprovado para retomar a conversa.";

const done = (conversationId?: string) => {
  revalidatePath("/atendimento");
  if (conversationId) revalidatePath(`/atendimento?conversa=${conversationId}`);
};

// --- Conexão do número (Cloud API) ---------------------------------------------------

export const connectWhatsAppNumber = defineAction(
  {
    schema: z.object({
      phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, "Informe o ID do número (só dígitos)."),
      wabaId: z.string().trim().regex(/^\d{5,30}$/, "Informe o ID da conta do WhatsApp Business (só dígitos)."),
      token: z.string().trim().min(50, "Cole o token de acesso permanente do usuário do sistema.").max(1000),
    }),
    permission: "inbox.manage",
  },
  async (input, { user }) => {
    if (!whatsappConfigured()) return fail("business_rule", NOT_CONFIGURED);
    // Confere na Meta antes de salvar: se o token não acessar o número, nada é gravado.
    let info: Awaited<ReturnType<typeof numberInfo>>;
    try {
      info = await numberInfo(input.phoneNumberId, input.token);
    } catch {
      return fail("validation", "A Meta não reconheceu esse número com esse token. Confira o ID do número e as permissões whatsapp_business_messaging e whatsapp_business_management.");
    }
    const admin = createAdminClient();
    const { data: existing } = await admin.from("whatsapp_numbers").select("organization_id").eq("phone_number_id", input.phoneNumberId).maybeSingle();
    if (existing && existing.organization_id !== user.organizationId) return fail("conflict", "Este número já está conectado em outra organização.");
    must(
      await admin.from("whatsapp_numbers").upsert(
        {
          organization_id: user.organizationId,
          phone_number_id: input.phoneNumberId,
          waba_id: input.wabaId,
          display_phone: info.display_phone_number,
          verified_name: info.verified_name,
          quality: info.quality_rating ?? null,
          token_enc: encrypt(input.token),
          status: "ativo",
          last_error: null,
          connected_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "phone_number_id" },
      ),
    );
    revalidatePath("/atendimento");
    revalidatePath("/configuracoes/integracoes");
    return ok(null, `Número ${info.display_phone_number} conectado.`);
  },
);

export const disconnectWhatsAppNumber = defineAction({ schema: z.object({ id: z.uuid() }), permission: "inbox.manage" }, async ({ id }, { user }) => {
  const admin = createAdminClient();
  const { data: number } = await admin.from("whatsapp_numbers").select("provider, waha_url, waha_session, token_enc").eq("id", id).eq("organization_id", user.organizationId).maybeSingle();
  // QR Code: encerra a sessão no servidor e desliga o aparelho.
  if (number?.provider === "waha") await wahaDeleteSession({ url: number.waha_url as string, key: decrypt(number.token_enc), session: number.waha_session as string }).catch(() => null);
  // As conversas ficam (histórico); o token é apagado.
  must(await admin.from("whatsapp_numbers").update({ status: "desconectado", token_enc: encrypt("revogado") }).eq("id", id).eq("organization_id", user.organizationId));
  revalidatePath("/atendimento");
  revalidatePath("/configuracoes/integracoes");
  return ok(null, "Número desconectado. O histórico de conversas foi mantido.");
});

export const syncWhatsAppTemplates = defineAction({ schema: z.object({ numberId: z.uuid() }), permission: "inbox.manage" }, async ({ numberId }, { user }) => {
  const admin = createAdminClient();
  const { data: n } = await admin.from("whatsapp_numbers").select("organization_id, provider").eq("id", numberId).maybeSingle();
  if (!n || n.organization_id !== user.organizationId) return fail("not_found", "Número não encontrado.");
  if (n.provider === "waha") return fail("business_rule", "Modelos existem só na API oficial.");
  try {
    const { wabaId, templates } = await fetchTemplates(numberId);
    for (const t of templates) {
      await admin.from("whatsapp_templates").upsert(
        { organization_id: user.organizationId, waba_id: wabaId, name: t.name, language: t.language, category: t.category, status: t.status, components: t.components, synced_at: new Date().toISOString() },
        { onConflict: "organization_id,waba_id,name,language" },
      );
    }
    revalidatePath("/atendimento");
    return ok(null, `${templates.length} modelo(s) sincronizado(s).`);
  } catch {
    return fail("network", "Não foi possível buscar os modelos na Meta agora.");
  }
});

// --- Mensagens -------------------------------------------------------------------------

type ConvRow = { id: string; number_id: string; contact_e164: string; last_inbound_at: string | null; lead_id: string | null; organization_id: string; first_response_at: string | null };

async function loadConversation(id: string) {
  const supabase = await createClient();
  const conv = (await supabase.from("conversations").select("id, number_id, contact_e164, last_inbound_at, lead_id, organization_id, first_response_at").eq("id", id).maybeSingle()).data as ConvRow | null;
  if (!conv) return null;
  const { data: lead } = conv.lead_id ? await supabase.from("leads").select("contact_opt_out_at").eq("id", conv.lead_id).maybeSingle() : { data: null };
  return { conv, optOut: Boolean(lead?.contact_opt_out_at) };
}

type OutgoingFile = { media_id: string; media_mime: string; media_name: string };

async function recordOutgoing(conv: ConvRow, clientRef: string, wamid: string | null, type: string, body: string, authorId: string, error?: string, file?: OutgoingFile) {
  const admin = createAdminClient();
  const { error: insertError } = await admin.from("messages").insert({
    organization_id: conv.organization_id,
    conversation_id: conv.id,
    direction: "saida",
    wamid,
    client_ref: clientRef,
    type,
    body,
    status: error ? "erro" : "enviada",
    error: error ?? null,
    author_id: authorId,
    ...file,
  });
  // No QR Code o eco do envio pode chegar antes: a mensagem já existe, só falta dizer quem enviou.
  if (insertError?.code === "23505" && wamid) await admin.from("messages").update({ client_ref: clientRef, author_id: authorId, ...file }).eq("wamid", wamid);
  if (!error) {
    const now = new Date().toISOString();
    await admin
      .from("conversations")
      .update({ last_message_at: now, waiting_reply: false, unread_count: 0, ...(conv.first_response_at ? {} : { first_response_at: now }) })
      .eq("id", conv.id);
    if (conv.lead_id) {
      await admin.from("activities").insert({
        organization_id: conv.organization_id,
        lead_id: conv.lead_id,
        type: "whatsapp",
        content: `Mensagem enviada: ${(body || file?.media_name || "arquivo").slice(0, 300)}`,
        metadata: { conversation_id: conv.id, origem: "manual" },
        created_by: authorId,
      });
    }
  }
}

/** Regras de cada canal. A janela de 24 horas é da API oficial; o QR Code só precisa estar conectado. */
async function channelBlock(conv: ConvRow) {
  const channel = await numberProvider(conv.number_id);
  if (channel.provider === "waha") return channel.status === "ativo" ? null : QR_OFFLINE;
  if (!whatsappConfigured()) return NOT_CONFIGURED;
  if (!conv.last_inbound_at || Date.now() - new Date(conv.last_inbound_at).getTime() > WINDOW_MS) return OUTSIDE_WINDOW;
  return null;
}

const sendSchema = z.object({ conversationId: z.uuid(), clientRef: z.uuid(), body: z.string().trim().min(1, "Escreva a mensagem.").max(4096) });

export const sendWhatsAppMessage = defineAction({ schema: sendSchema, permission: "inbox.reply" }, async (input, { user }) => {
  if (!(await withinRateLimit(`wa-send:${user.id}`, 60, 60))) return fail("business_rule", RATE_LIMIT_MESSAGE);
  const loaded = await loadConversation(input.conversationId);
  if (!loaded) return fail("not_found", "Conversa não encontrada.");
  const { conv, optOut } = loaded;
  if (optOut) return fail("business_rule", "Este contato pediu para não receber mensagens. O envio está bloqueado.");
  const blocked = await channelBlock(conv);
  if (blocked) return fail("business_rule", blocked);
  const admin = createAdminClient();
  const { data: dup } = await admin.from("messages").select("id").eq("client_ref", input.clientRef).maybeSingle();
  if (dup) return ok(null); // clique repetido: já enviado
  try {
    const wamid = await sendText(conv.number_id, conv.contact_e164, input.body);
    await recordOutgoing(conv, input.clientRef, wamid, "text", input.body, user.id);
  } catch (e) {
    const detail = (e as { detail?: string }).detail;
    await recordOutgoing(conv, input.clientRef, null, "text", input.body, user.id, detail?.slice(0, 300) ?? "Falha no envio");
    done(conv.id);
    return fail("network", "O WhatsApp recusou o envio. A mensagem ficou marcada com erro.");
  }
  done(conv.id);
  return ok(null);
});

/** Reserva o envio direto do navegador para o armazenamento: arquivos grandes não passam pelo servidor. */
export const prepareWhatsAppUpload = defineAction(
  { schema: z.object({ conversationId: z.uuid(), mime: z.string().max(120), size: z.number().int().nonnegative() }), permission: "inbox.reply" },
  async (input, { user }) => {
    const loaded = await loadConversation(input.conversationId);
    if (!loaded) return fail("not_found", "Conversa não encontrada.");
    const { provider } = await numberProvider(loaded.conv.number_id);
    const check = checkOutgoingMedia({ mime: input.mime, size: input.size, provider });
    if (!check.ok) return fail("validation", check.message);
    const path = outgoingPath(user.organizationId, crypto.randomUUID());
    const { data, error } = await createAdminClient().storage.from("whatsapp-media").createSignedUploadUrl(path);
    if (error || !data) return fail("network", "Não foi possível preparar o envio do arquivo.");
    return ok({ path, token: data.token });
  },
);

export const sendWhatsAppMedia = defineAction(
  {
    schema: z.object({
      conversationId: z.uuid(),
      clientRef: z.uuid(),
      path: z.string().max(200),
      mime: z.string().max(120),
      size: z.number().int().nonnegative(),
      name: z.string().trim().min(1).max(200),
      caption: z.string().trim().max(1024).default(""),
    }),
    permission: "inbox.reply",
  },
  async (input, { user }) => {
    if (!(await withinRateLimit(`wa-send:${user.id}`, 60, 60))) return fail("business_rule", RATE_LIMIT_MESSAGE);
    if (!isOutgoingPath(input.path, user.organizationId)) return fail("forbidden", "Arquivo inválido.");
    const loaded = await loadConversation(input.conversationId);
    if (!loaded) return fail("not_found", "Conversa não encontrada.");
    const { conv, optOut } = loaded;
    if (optOut) return fail("business_rule", "Este contato pediu para não receber mensagens. O envio está bloqueado.");
    const blocked = await channelBlock(conv);
    if (blocked) return fail("business_rule", blocked);
    const { provider } = await numberProvider(conv.number_id);
    const check = checkOutgoingMedia({ mime: input.mime, size: input.size, provider });
    if (!check.ok) return fail("validation", check.message);
    const admin = createAdminClient();
    const { data: dup } = await admin.from("messages").select("id").eq("client_ref", input.clientRef).maybeSingle();
    if (dup) return ok(null);
    const mime = baseMime(input.mime);
    const file = { media_id: `storage:${input.path}`, media_mime: mime, media_name: input.name };
    // Link temporário: o WhatsApp baixa o arquivo sem que o armazenamento fique público.
    const { data: signed } = await admin.storage.from("whatsapp-media").createSignedUrl(input.path, 3600);
    if (!signed) return fail("network", "O arquivo não foi encontrado. Tente anexar de novo.");
    try {
      const wamid = await sendMedia(conv.number_id, conv.contact_e164, { url: signed.signedUrl, mime, name: input.name, caption: input.caption || null, kind: check.kind });
      await recordOutgoing(conv, input.clientRef, wamid, check.kind, input.caption, user.id, undefined, file);
    } catch (e) {
      await recordOutgoing(conv, input.clientRef, null, check.kind, input.caption, user.id, (e as { detail?: string }).detail?.slice(0, 300) ?? "Falha no envio", file);
      done(conv.id);
      return fail("network", "O WhatsApp recusou o arquivo. A mensagem ficou marcada com erro.");
    }
    done(conv.id);
    return ok(null);
  },
);

export const sendWhatsAppTemplate = defineAction(
  {
    schema: z.object({
      conversationId: z.uuid(),
      clientRef: z.uuid(),
      templateId: z.uuid(),
      params: z.array(z.string().trim().min(1, "Preencha todas as variáveis.").max(1000)).max(20),
    }),
    permission: "inbox.reply",
  },
  async (input, { user }) => {
    if (!whatsappConfigured()) return fail("business_rule", NOT_CONFIGURED);
    if (!(await withinRateLimit(`wa-send:${user.id}`, 60, 60))) return fail("business_rule", RATE_LIMIT_MESSAGE);
    const loaded = await loadConversation(input.conversationId);
    if (!loaded) return fail("not_found", "Conversa não encontrada.");
    if (loaded.optOut) return fail("business_rule", "Este contato pediu para não receber mensagens. O envio está bloqueado.");
    const supabase = await createClient();
    const tpl = (await supabase.from("whatsapp_templates").select("name, language, status, components").eq("id", input.templateId).maybeSingle()).data;
    if (!tpl) return fail("not_found", "Modelo não encontrado.");
    if (tpl.status !== "APPROVED") return fail("business_rule", "Só modelos aprovados pela Meta podem ser enviados.");
    const body = ((tpl.components as { type: string; text?: string }[]).find((c) => c.type === "BODY")?.text ?? "") as string;
    const expected = new Set(body.match(/\{\{\d+\}\}/g) ?? []).size;
    if (input.params.length !== expected) return fail("validation", `Este modelo precisa de ${expected} variável(is).`);
    const preview = body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => input.params[Number(n) - 1] ?? "");
    const admin = createAdminClient();
    const { data: dup } = await admin.from("messages").select("id").eq("client_ref", input.clientRef).maybeSingle();
    if (dup) return ok(null);
    try {
      const wamid = await sendTemplate(loaded.conv.number_id, loaded.conv.contact_e164, tpl.name, tpl.language, input.params);
      await recordOutgoing(loaded.conv, input.clientRef, wamid, "template", preview || tpl.name, user.id);
    } catch (e) {
      await recordOutgoing(loaded.conv, input.clientRef, null, "template", preview || tpl.name, user.id, (e as { detail?: string }).detail?.slice(0, 300) ?? "Falha no envio");
      done(loaded.conv.id);
      return fail("network", "O WhatsApp recusou o modelo. Confira as variáveis e o status do modelo.");
    }
    done(loaded.conv.id);
    return ok(null, "Modelo enviado.");
  },
);

export const addInternalNote = defineAction({ schema: z.object({ conversationId: z.uuid(), body: z.string().trim().min(1).max(4096) }), permission: "inbox.read" }, async (input, { user }) => {
  const supabase = await createClient();
  must(await supabase.from("messages").insert({ organization_id: user.organizationId, conversation_id: input.conversationId, direction: "nota", type: "note", body: input.body, status: "enviada", author_id: user.id }));
  done(input.conversationId);
  return ok(null, "Observação interna registrada.");
});

export const toggleImportant = defineAction({ schema: z.object({ id: z.uuid(), important: z.boolean() }), permission: "inbox.read" }, async (input) => {
  const supabase = await createClient();
  must(await supabase.from("messages").update({ important: input.important }).eq("id", input.id));
  done();
  return ok(null);
});

export const markConversationRead = defineAction({ schema: z.object({ id: z.uuid() }), permission: "inbox.read" }, async ({ id }) => {
  const supabase = await createClient();
  const res = must(await supabase.from("conversations").update({ unread_count: 0 }).eq("id", id).select("number_id, contact_e164")) as { number_id: string; contact_e164: string }[];
  if (res.length) {
    const channel = await numberProvider(res[0].number_id);
    if (channel.provider === "waha" ? channel.status === "ativo" : whatsappConfigured()) {
      const { data: last } = await supabase.from("messages").select("wamid").eq("conversation_id", id).eq("direction", "entrada").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (last?.wamid) await markRead(res[0].number_id, last.wamid, res[0].contact_e164);
    }
  }
  return ok(null);
});

// --- Atendimento: responsável, situação, lead e etiquetas ------------------------------

export const assignConversation = defineAction({ schema: z.object({ id: z.uuid(), assigneeId: z.uuid().nullable() }), permission: ["inbox.manage", "inbox.reply"] }, async (input) => {
  const supabase = await createClient();
  const res = must(await supabase.from("conversations").update({ assignee_id: input.assigneeId }).eq("id", input.id).select("id")) as { id: string }[];
  if (!res.length) return fail("forbidden", "Você não pode transferir esta conversa.");
  done(input.id);
  return ok(null, input.assigneeId ? "Atendimento transferido." : "Conversa sem responsável.");
});

export const setConversationStatus = defineAction(
  { schema: z.object({ id: z.uuid(), status: z.enum(["aberta", "encerrada"]), outcome: z.string().trim().max(500).default("") }),
    permission: "inbox.reply" },
  async (input) => {
    const supabase = await createClient();
    const res = must(
      await supabase
        .from("conversations")
        .update({ status: input.status, waiting_reply: input.status === "aberta" ? undefined : false, outcome: input.status === "encerrada" ? input.outcome || null : null })
        .eq("id", input.id)
        .select("id, lead_id, organization_id"),
    ) as { id: string; lead_id: string | null; organization_id: string }[];
    if (!res.length) return fail("forbidden", "Você não pode alterar esta conversa.");
    if (input.status === "encerrada" && res[0].lead_id) {
      await supabase.from("activities").insert({ lead_id: res[0].lead_id, type: "nota", content: `Atendimento encerrado${input.outcome ? `: ${input.outcome}` : "."}` });
    }
    done(input.id);
    return ok(null, input.status === "encerrada" ? "Atendimento encerrado." : "Atendimento reaberto.");
  },
);

export const createLeadFromConversation = defineAction(
  {
    schema: z.object({
      conversationId: z.uuid(),
      name: z.string().trim().min(2, "Informe o nome.").max(160),
      company: z.string().trim().max(160).default(""),
      email: z.union([z.literal(""), z.email("E-mail inválido.")]).default(""),
      pipelineId: z.uuid(),
      notes: z.string().trim().max(2000).default(""),
      consent: z.boolean().default(false),
    }),
    permission: "crm.leads.create",
  },
  async (input, { user }) => {
    const supabase = await createClient();
    const conv = must(await supabase.from("conversations").select("id, contact_e164, lead_id, assignee_id").eq("id", input.conversationId).single()) as {
      id: string;
      contact_e164: string;
      lead_id: string | null;
      assignee_id: string | null;
    };
    if (conv.lead_id) return fail("conflict", "Esta conversa já está vinculada a um lead.");
    // Evita duplicado: procura o telefone nas duas formas (com e sem o 9º dígito).
    const variants = brPhoneVariants(conv.contact_e164);
    const { data: existing } = await supabase.from("leads").select("id, name").is("deleted_at", null).or(variants.map((v) => `phone_e164.eq.${v},whatsapp_e164.eq.${v}`).join(",")).limit(1).maybeSingle();
    if (existing) {
      must(await supabase.from("conversations").update({ lead_id: existing.id }).eq("id", conv.id));
      done(conv.id);
      return ok({ id: existing.id }, `Já existia o lead “${existing.name}” com este telefone. A conversa foi vinculada a ele.`);
    }
    const owner = conv.assignee_id ?? user.id;
    const { data: fromAd } = await supabase.from("ad_referrals").select("source_type").eq("conversation_id", conv.id).order("created_at").limit(1).maybeSingle();
    const lead = must(
      await supabase
        .from("leads")
        .insert({
          name: input.name,
          company_name: input.company || null,
          email: input.email || null,
          phone_e164: conv.contact_e164,
          whatsapp_e164: conv.contact_e164,
          source: fromAd ? (fromAd.source_type === "post" ? "Publicação Meta (WhatsApp)" : "Anúncio Meta (WhatsApp)") : "WhatsApp",
          notes: input.notes || null,
          owner_id: owner,
          whatsapp_consent_at: input.consent ? new Date().toISOString() : null,
        })
        .select("id")
        .single(),
    ) as { id: string };
    const stage = must(await supabase.from("stages").select("id").eq("pipeline_id", input.pipelineId).eq("kind", "open").is("archived_at", null).order("position").limit(1).single()) as { id: string };
    must(await supabase.from("deals").insert({ lead_id: lead.id, pipeline_id: input.pipelineId, stage_id: stage.id, owner_id: owner, position: Date.now() / 1000 }));
    must(await supabase.from("conversations").update({ lead_id: lead.id }).eq("id", conv.id));
    must(await supabase.from("activities").insert({ lead_id: lead.id, type: "sistema", content: fromAd ? "Lead criado a partir de conversa do WhatsApp iniciada por anúncio da Meta" : "Lead criado a partir de conversa do WhatsApp" }));
    revalidatePath("/crm", "layout");
    done(conv.id);
    return ok({ id: lead.id }, "Lead criado e vinculado à conversa.");
  },
);

export const setConversationTags = defineAction({ schema: z.object({ id: z.uuid(), tagIds: z.array(z.uuid()).max(20) }), permission: "inbox.reply" }, async (input) => {
  const supabase = await createClient();
  must(await supabase.from("conversation_tags").delete().eq("conversation_id", input.id));
  if (input.tagIds.length) must(await supabase.from("conversation_tags").insert(input.tagIds.map((tag_id) => ({ conversation_id: input.id, tag_id }))));
  done(input.id);
  return ok(null);
});
