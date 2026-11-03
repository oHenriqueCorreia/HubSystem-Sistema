import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { numberProvider, sendTemplate, sendText } from "@/lib/whatsapp";
import { brPhoneVariants } from "@/domain/shared/phone";

const WINDOW_MS = 24 * 3600_000;

export class SendBlocked extends Error {}

type Automated = {
  organizationId: string;
  numberId: string;
  phone: string;
  leadId: string | null;
  contactName: string;
  /** Id estável da origem: repetir a mesma execução não envia de novo. */
  clientRef: string;
  body: string;
  /** Sem conversa iniciada pelo contato, exige autorização registrada no lead. */
  requireConsent: boolean;
  template?: { name: string; language: string; params: string[] } | null;
};

/**
 * Único caminho de envio automático (automação, campanha, cobrança).
 * As travas ficam aqui: pedido para sair, autorização, número conectado e janela da API oficial.
 */
export async function sendAutomated(input: Automated) {
  const admin = createAdminClient();
  const { data: lead } = input.leadId ? await admin.from("leads").select("contact_opt_out_at, whatsapp_consent_at, owner_id").eq("id", input.leadId).maybeSingle() : { data: null };
  if (lead?.contact_opt_out_at) throw new SendBlocked("o contato pediu para não receber mensagens");

  const channel = await numberProvider(input.numberId);
  if (channel.status !== "ativo") throw new SendBlocked("o número de WhatsApp está desconectado");

  const { data: found } = await admin.from("conversations").select("id, last_inbound_at").eq("number_id", input.numberId).in("contact_e164", brPhoneVariants(input.phone)).limit(1).maybeSingle();
  if (input.requireConsent && !lead?.whatsapp_consent_at) throw new SendBlocked("sem autorização do contato registrada no lead");
  if (channel.provider === "cloud" && !input.template && (!found?.last_inbound_at || Date.now() - new Date(found.last_inbound_at).getTime() > WINDOW_MS)) {
    throw new SendBlocked("a API oficial só permite texto livre até 24 horas depois da última mensagem do cliente");
  }

  const { data: dup } = await admin.from("messages").select("id").eq("client_ref", input.clientRef).maybeSingle();
  if (dup) return;

  let conversationId = found?.id;
  if (!conversationId) {
    const { data: created, error: createError } = await admin
      .from("conversations")
      .upsert(
        { organization_id: input.organizationId, number_id: input.numberId, contact_e164: input.phone, contact_name: input.contactName.slice(0, 120), lead_id: input.leadId, assignee_id: lead?.owner_id ?? null },
        { onConflict: "number_id,contact_e164" },
      )
      .select("id")
      .single();
    if (createError || !created) throw new Error("Não foi possível abrir a conversa.");
    conversationId = created.id;
  }

  const useTemplate = channel.provider === "cloud" && input.template;
  const wamid = useTemplate ? await sendTemplate(input.numberId, input.phone, input.template!.name, input.template!.language, input.template!.params) : await sendText(input.numberId, input.phone, input.body);
  const row = { organization_id: input.organizationId, conversation_id: conversationId, direction: "saida", wamid, client_ref: input.clientRef, type: useTemplate ? "template" : "text", body: input.body, status: "enviada" };
  const { error } = await admin.from("messages").insert(row);
  // O eco do QR Code pode ter chegado antes e gravado a mesma mensagem.
  if (error?.code === "23505" && wamid) {
    const { error: updateError } = await admin.from("messages").update({ client_ref: input.clientRef }).eq("wamid", wamid);
    if (updateError) throw updateError;
  } else if (error) {
    throw error;
  }
  await admin.from("conversations").update({ last_message_at: new Date().toISOString(), waiting_reply: false }).eq("id", conversationId);
  if (input.leadId) {
    await admin.from("activities").insert({ organization_id: input.organizationId, lead_id: input.leadId, type: "whatsapp", content: `Mensagem automática enviada: ${input.body.slice(0, 300)}`, metadata: { conversation_id: conversationId, origem: "automatica" }, created_by: null });
  }
}
