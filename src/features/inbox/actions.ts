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
import { scopedWamid, unscopedWamid } from "@/domain/whatsapp/waha";
import { wahaDeleteSession } from "@/lib/waha";
import { purgeNumberData } from "@/lib/whatsapp-import";
import { MESSAGE_COLUMNS, MESSAGE_PAGE, type Message } from "./message-columns";
import { visibleNumberIds } from "./queries";
import { fetchTemplates, markRead, numberInfo, numberProvider, sendMedia, sendTemplate, sendText, whatsappConfigured } from "@/lib/whatsapp";

const NOT_CONFIGURED = "O WhatsApp ainda não foi configurado no servidor (META_APP_SECRET e WHATSAPP_VERIFY_TOKEN).";
const WINDOW_MS = 24 * 3600_000;
const QR_OFFLINE = "O WhatsApp por QR Code está desconectado. Reconecte o número para enviar.";
const OUTSIDE_WINDOW = "Passaram mais de 24 horas desde a última mensagem do cliente. Envie um modelo aprovado para retomar a conversa.";

// A resposta da ação já traz a tela atualizada (uma ida ao servidor só).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const done = (_conversationId?: string) => revalidatePath("/atendimento");

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
  if (!number) return fail("not_found", "Número não encontrado.");
  // Primeiro para de receber; depois apaga. Leads, negócios e etiquetas continuam.
  must(await admin.from("whatsapp_numbers").update({ status: "desconectado", token_enc: encrypt("revogado"), compiled_at: null, purge_pending: true }).eq("id", id).eq("organization_id", user.organizationId));
  await purgeNumberData(id, 40_000);
  revalidatePath("/atendimento");
  revalidatePath("/configuracoes/integracoes");
  return ok(null, "Número desconectado. As conversas dele foram apagadas do sistema.");
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

type ConvRow = { id: string; number_id: string; contact_e164: string | null; group_jid: string | null; last_inbound_at: string | null; lead_id: string | null; organization_id: string; first_response_at: string | null };

/** Para onde a mensagem vai: telefone do contato ou endereço do grupo. */
const addressOf = (conv: Pick<ConvRow, "contact_e164" | "group_jid">) => (conv.group_jid ?? conv.contact_e164) as string;
const storedWamid = (conv: Pick<ConvRow, "number_id" | "group_jid">, wamid: string | null) => (wamid && conv.group_jid ? scopedWamid(conv.number_id, wamid) : wamid);

async function loadConversation(id: string) {
  const supabase = await createClient();
  // Conversa e pedido de saída do lead numa consulta só.
  const { data } = await supabase
    .from("conversations")
    .select("id, number_id, contact_e164, group_jid, last_inbound_at, lead_id, organization_id, first_response_at, lead:leads(contact_opt_out_at)")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const lead = (Array.isArray(data.lead) ? data.lead[0] : data.lead) as { contact_opt_out_at: string | null } | null;
  return { conv: data as unknown as ConvRow, optOut: Boolean(lead?.contact_opt_out_at) };
}

type OutgoingFile = { media_id: string; media_mime: string; media_name: string };

async function recordOutgoing(conv: ConvRow, clientRef: string, wamid: string | null, type: string, body: string, authorId: string, error?: string, file?: OutgoingFile, replyToWamid?: string) {
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
    reply_to_wamid: replyToWamid ?? null,
    ...file,
  });
  // No QR Code o eco do envio pode chegar antes: a mensagem já existe, só falta dizer quem enviou.
  if (insertError?.code === "23505" && wamid) await admin.from("messages").update({ client_ref: clientRef, author_id: authorId, reply_to_wamid: replyToWamid ?? null, ...file }).eq("wamid", wamid);
  if (!error) {
    const now = new Date().toISOString();
    await Promise.all([
      admin
        .from("conversations")
        .update({ last_message_at: now, waiting_reply: false, unread_count: 0, ...(conv.first_response_at ? {} : { first_response_at: now }) })
        .eq("id", conv.id),
      conv.lead_id
        ? admin.from("activities").insert({
            organization_id: conv.organization_id,
            lead_id: conv.lead_id,
            type: "whatsapp",
            content: `Mensagem enviada: ${(body || file?.media_name || "arquivo").slice(0, 300)}`,
            metadata: { conversation_id: conv.id, origem: "manual" },
            created_by: authorId,
          })
        : Promise.resolve(),
    ]);
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

const sendSchema = z.object({ conversationId: z.uuid(), clientRef: z.uuid(), body: z.string().trim().min(1, "Escreva a mensagem.").max(4096), replyToId: z.uuid().nullable().optional() });

export const sendWhatsAppMessage = defineAction({ schema: sendSchema, permission: "inbox.reply" }, async (input, { user }) => {
  const admin = createAdminClient();
  // Tudo o que não depende de nada vai junto: limite, conversa, clique repetido e mensagem citada.
  const [allowed, loaded, { data: dup }, { data: quotedRow }] = await Promise.all([
    withinRateLimit(`wa-send:${user.id}`, 60, 60),
    loadConversation(input.conversationId),
    admin.from("messages").select("id").eq("client_ref", input.clientRef).maybeSingle(),
    input.replyToId ? admin.from("messages").select("wamid, direction, sender_jid, conversation_id").eq("id", input.replyToId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!allowed) return fail("business_rule", RATE_LIMIT_MESSAGE);
  if (!loaded) return fail("not_found", "Conversa não encontrada.");
  const { conv, optOut } = loaded;
  if (optOut) return fail("business_rule", "Este contato pediu para não receber mensagens. O envio está bloqueado.");
  if (dup) return ok(null); // clique repetido: já enviado
  const blocked = await channelBlock(conv);
  if (blocked) return fail("business_rule", blocked);
  try {
    // Citação: só de mensagem desta mesma conversa, que já tenha id no WhatsApp.
    const quoted = quotedRow && quotedRow.conversation_id === conv.id ? quotedRow : null;
    const replyTo = quoted?.wamid ? { wamid: unscopedWamid(quoted.wamid as string), fromMe: quoted.direction === "saida", participant: quoted.sender_jid as string | null } : null;
    const wamid = await sendText(conv.number_id, addressOf(conv), input.body, replyTo);
    await recordOutgoing(conv, input.clientRef, storedWamid(conv, wamid), "text", input.body, user.id, undefined, undefined, quoted?.wamid as string | undefined);
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
      const wamid = await sendMedia(conv.number_id, addressOf(conv), { url: signed.signedUrl, mime, name: input.name, caption: input.caption || null, kind: check.kind });
      await recordOutgoing(conv, input.clientRef, storedWamid(conv, wamid), check.kind, input.caption, user.id, undefined, file);
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
      const wamid = await sendTemplate(loaded.conv.number_id, addressOf(loaded.conv), tpl.name, tpl.language, input.params);
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
  const res = must(await supabase.from("conversations").update({ unread_count: 0 }).eq("id", id).select("number_id, contact_e164, group_jid")) as { number_id: string; contact_e164: string | null; group_jid: string | null }[];
  if (res.length) {
    const channel = await numberProvider(res[0].number_id);
    if (channel.provider === "waha" ? channel.status === "ativo" : whatsappConfigured()) {
      const { data: last } = await supabase.from("messages").select("wamid, imported").eq("conversation_id", id).eq("direction", "entrada").order("created_at", { ascending: false }).limit(1).maybeSingle();
      // Abrir uma conversa antiga do histórico não manda tique azul para ninguém.
      if (last?.wamid && !last.imported) await markRead(res[0].number_id, unscopedWamid(last.wamid), addressOf(res[0]));
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
      contact_e164: string | null;
      lead_id: string | null;
      assignee_id: string | null;
    };
    if (conv.lead_id) return fail("conflict", "Esta conversa já está vinculada a um lead.");
    if (!conv.contact_e164) return fail("business_rule", "Grupo não vira lead. Ligue o grupo a um cliente.");
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

/** Liga o grupo ou a conversa a um cliente da empresa. */
export const setConversationClient = defineAction({ schema: z.object({ id: z.uuid(), clientId: z.uuid().nullable() }), permission: "inbox.reply" }, async (input) => {
  const supabase = await createClient();
  if (input.clientId) {
    const { data: client } = await supabase.from("clients").select("id").eq("id", input.clientId).maybeSingle();
    if (!client) return fail("not_found", "Cliente não encontrado.");
  }
  const res = must(await supabase.from("conversations").update({ client_id: input.clientId }).eq("id", input.id).select("id")) as { id: string }[];
  if (!res.length) return fail("forbidden", "Você não pode alterar esta conversa.");
  done(input.id);
  return ok(null, input.clientId ? "Conversa ligada ao cliente." : "Cliente removido da conversa.");
});

/** Mensagens anteriores às que estão na tela. */
export const loadOlderMessages = defineAction({ schema: z.object({ conversationId: z.uuid(), before: z.iso.datetime({ offset: true }) }), permission: "inbox.read" }, async ({ conversationId, before }) => {
  const supabase = await createClient();
  const rows = must(await supabase.from("messages").select(MESSAGE_COLUMNS).eq("conversation_id", conversationId).lt("created_at", before).order("created_at", { ascending: false }).limit(MESSAGE_PAGE)) as unknown as Message[];
  return ok({ messages: rows.reverse(), hasMore: rows.length === MESSAGE_PAGE });
});

/** Salva a ficha do contato. Com lead, o nome e os dados valem para o lead: funil e leads mostram o mesmo. */
export const saveContact = defineAction(
  {
    schema: z.object({
      conversationId: z.uuid(),
      name: z.string().trim().min(2, "Informe o nome.").max(120),
      company: z.string().trim().max(160).default(""),
      email: z.union([z.literal(""), z.email("E-mail inválido.")]).default(""),
      notes: z.string().trim().max(2000).default(""),
    }),
    permission: "inbox.reply",
  },
  async (input) => {
    const supabase = await createClient();
    const res = must(await supabase.from("conversations").update({ contact_name: input.name }).eq("id", input.conversationId).select("lead_id")) as { lead_id: string | null }[];
    if (!res.length) return fail("forbidden", "Você não pode alterar este contato.");
    if (res[0].lead_id) {
      const lead = must(await supabase.from("leads").update({ name: input.name, company_name: input.company || null, email: input.email || null, notes: input.notes || null }).eq("id", res[0].lead_id).select("id")) as { id: string }[];
      if (!lead.length) return fail("forbidden", "O nome da conversa mudou, mas você não pode editar este lead.");
      revalidatePath("/crm", "layout");
    }
    done(input.conversationId);
    return ok(null, "Contato salvo.");
  },
);

async function deliverSticker(conv: ConvRow, clientRef: string, path: string, authorId: string) {
  const admin = createAdminClient();
  const file = { media_id: `storage:${path}`, media_mime: "image/webp", media_name: "figurinha.webp" };
  const { data: signed } = await admin.storage.from("whatsapp-media").createSignedUrl(path, 3600);
  if (!signed) return fail("network", "A figurinha não foi encontrada. Tente de novo.");
  try {
    const wamid = await sendMedia(conv.number_id, addressOf(conv), { url: signed.signedUrl, mime: "image/webp", name: "figurinha.webp", kind: "sticker" });
    await recordOutgoing(conv, clientRef, storedWamid(conv, wamid), "sticker", "", authorId, undefined, file);
  } catch (e) {
    await recordOutgoing(conv, clientRef, null, "sticker", "", authorId, (e as { detail?: string }).detail?.slice(0, 300) ?? "Falha no envio", file);
    done(conv.id);
    return fail("network", "O WhatsApp recusou a figurinha. A mensagem ficou marcada com erro.");
  }
  done(conv.id);
  return ok(null);
}

async function loadForSending(conversationId: string, clientRef: string) {
  const loaded = await loadConversation(conversationId);
  if (!loaded) return fail("not_found", "Conversa não encontrada.");
  if (loaded.optOut) return fail("business_rule", "Este contato pediu para não receber mensagens. O envio está bloqueado.");
  const blocked = await channelBlock(loaded.conv);
  if (blocked) return fail("business_rule", blocked);
  const { data: dup } = await createAdminClient().from("messages").select("id").eq("client_ref", clientRef).maybeSingle();
  return dup ? null : loaded.conv;
}

/** Vira figurinha uma imagem que a pessoa escolheu: quadrada, 512 px e em WebP, como o WhatsApp pede. */
export const sendImageAsSticker = defineAction({ schema: z.object({ conversationId: z.uuid(), clientRef: z.uuid(), path: z.string().max(200) }), permission: "inbox.reply" }, async (input, { user }) => {
  if (!(await withinRateLimit(`wa-send:${user.id}`, 60, 60))) return fail("business_rule", RATE_LIMIT_MESSAGE);
  if (!isOutgoingPath(input.path, user.organizationId)) return fail("forbidden", "Arquivo inválido.");
  const conv = await loadForSending(input.conversationId, input.clientRef);
  if (!conv) return ok(null);
  if ("ok" in conv) return conv;
  const admin = createAdminClient();
  const { data: original } = await admin.storage.from("whatsapp-media").download(input.path);
  if (!original) return fail("network", "A imagem não foi encontrada. Tente de novo.");
  let sticker: Buffer;
  try {
    const { default: sharp } = await import("sharp");
    sticker = await sharp(Buffer.from(await original.arrayBuffer())).rotate().resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 80 }).toBuffer();
  } catch {
    return fail("validation", "Não foi possível transformar este arquivo em figurinha. Use uma imagem JPG ou PNG.");
  }
  const path = outgoingPath(user.organizationId, crypto.randomUUID());
  const { error } = await admin.storage.from("whatsapp-media").upload(path, sticker, { contentType: "image/webp" });
  await admin.storage.from("whatsapp-media").remove([input.path]);
  if (error) return fail("network", "Não foi possível preparar a figurinha.");
  return deliverSticker(conv, input.clientRef, path, user.id);
});

/** Reenvia uma figurinha que já passou por aqui, como as recentes do WhatsApp. */
export const sendSavedSticker = defineAction({ schema: z.object({ conversationId: z.uuid(), clientRef: z.uuid(), messageId: z.uuid() }), permission: "inbox.reply" }, async (input, { user }) => {
  if (!(await withinRateLimit(`wa-send:${user.id}`, 60, 60))) return fail("business_rule", RATE_LIMIT_MESSAGE);
  const conv = await loadForSending(input.conversationId, input.clientRef);
  if (!conv) return ok(null);
  if ("ok" in conv) return conv;
  const supabase = await createClient();
  const { data: source } = await supabase.from("messages").select("media_id").eq("id", input.messageId).eq("type", "sticker").maybeSingle();
  if (!source?.media_id?.startsWith("storage:")) return fail("not_found", "Esta figurinha não está mais disponível.");
  const admin = createAdminClient();
  // Cópia própria: se o número de origem for desconectado, esta conversa não perde a figurinha.
  const path = outgoingPath(user.organizationId, crypto.randomUUID());
  const { error } = await admin.storage.from("whatsapp-media").copy(source.media_id.slice("storage:".length), path);
  if (error) return fail("network", "Esta figurinha não está mais disponível.");
  return deliverSticker(conv, input.clientRef, path, user.id);
});

/** Figurinhas recentes da empresa, enviadas ou recebidas. */
export const listStickers = defineAction({ schema: z.object({}), permission: "inbox.read" }, async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("messages").select("id").eq("type", "sticker").like("media_id", "storage:%").order("created_at", { ascending: false }).limit(40);
  return ok({ ids: (data ?? []).map((m) => m.id as string) });
});

const EXCLUDE_BATCH = 50;

/** Tira as conversas do Atendimento: mensagens e arquivos saem; a linha fica para o grupo não voltar sozinho. */
async function excludeIds(ids: string[]) {
  const admin = createAdminClient();
  for (let i = 0; i < ids.length; i += EXCLUDE_BATCH) {
    const part = ids.slice(i, i + EXCLUDE_BATCH);
    for (let more = true; more; ) {
      const { data: files } = await admin.from("messages").select("id, media_id").in("conversation_id", part).like("media_id", "storage:%").limit(500);
      const paths = (files ?? []).map((m) => (m.media_id as string).slice("storage:".length));
      if (paths.length) await admin.storage.from("whatsapp-media").remove(paths).catch(() => null);
      if (files?.length) await admin.from("messages").update({ media_id: null }).in("id", files.map((m) => m.id as string));
      more = (files?.length ?? 0) === 500;
    }
    must(await admin.from("messages").delete().in("conversation_id", part));
    must(await admin.from("conversations").update({ excluded_at: new Date().toISOString(), unread_count: 0, waiting_reply: false, last_message_at: null, last_inbound_at: null }).in("id", part));
  }
}

const conversationIds = z.array(z.uuid()).min(1, "Selecione ao menos uma conversa.").max(200, "Selecione até 200 conversas por vez.");

export const excludeConversations = defineAction({ schema: z.object({ ids: conversationIds }), permission: "inbox.manage" }, async ({ ids }) => {
  const supabase = await createClient();
  // Só o que a pessoa enxerga pode ser excluído: a leitura passa pela RLS.
  const visible = must(await supabase.from("conversations").select("id").in("id", ids)) as { id: string }[];
  if (!visible.length) return fail("not_found", "Conversa não encontrada.");
  await excludeIds(visible.map((c) => c.id));
  done();
  return ok(null, visible.length === 1 ? "Conversa excluída." : `${visible.length} conversas excluídas.`);
});

/** Para quem tem muitos grupos: marca os que quer manter e o resto sai. */
export const excludeAllGroupsExcept = defineAction({ schema: z.object({ keep: conversationIds, numberId: z.uuid().optional() }), permission: "inbox.manage" }, async ({ keep, numberId }) => {
  const supabase = await createClient();
  // Só os que aparecem na lista: número ainda não compilado fica de fora.
  let q = supabase.from("conversations").select("id").in("number_id", await visibleNumberIds(supabase)).eq("kind", "grupo").is("excluded_at", null);
  if (numberId) q = q.eq("number_id", numberId);
  const groups = must(await q.limit(5000)) as { id: string }[];
  const kept = new Set(keep);
  const drop = groups.map((g) => g.id).filter((id) => !kept.has(id));
  await excludeIds(drop);
  done();
  return ok(null, `${drop.length} ${drop.length === 1 ? "grupo excluído" : "grupos excluídos"}. Ficaram os que você marcou.`);
});

export const restoreConversations = defineAction({ schema: z.object({ ids: conversationIds }), permission: "inbox.manage" }, async ({ ids }) => {
  const supabase = await createClient();
  const visible = must(await supabase.from("conversations").select("id").in("id", ids)) as { id: string }[];
  if (!visible.length) return fail("not_found", "Conversa não encontrada.");
  must(await createAdminClient().from("conversations").update({ excluded_at: null }).in("id", visible.map((c) => c.id)));
  done();
  return ok(null, visible.length === 1 ? "Conversa restaurada. Compile de novo para trazer as mensagens antigas." : `${visible.length} conversas restauradas. Compile de novo para trazer as mensagens antigas.`);
});
