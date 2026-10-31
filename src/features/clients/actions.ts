"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { fail, ok } from "@/domain/shared/result";
import { normalizePhone } from "@/domain/shared/phone";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES } from "./types";
import { attachmentEntitySchema, clientUpdateSchema, contractFormSchema, convertSchema, uploadRequestSchema } from "./schemas";

function contractRow(c: z.output<typeof contractFormSchema>) {
  return {
    title: c.title,
    service_id: c.serviceId ?? null,
    description: c.description || null,
    amount_cents: c.amountCents,
    payment_method: c.paymentMethod,
    recurrence: c.recurrence,
    start_date: c.startDate,
    end_date: c.endDate || null,
    due_day: c.dueDay ?? null,
    status: c.status,
    notes: c.notes || null,
    ...(c.ownerId ? { owner_id: c.ownerId } : {}),
  };
}

function revalidateClients(clientId?: string, leadId?: string) {
  revalidatePath("/clientes");
  revalidatePath("/contratos");
  if (clientId) revalidatePath(`/clientes/${clientId}`);
  if (leadId) revalidatePath(`/crm/leads/${leadId}`);
  revalidatePath("/crm/funil");
}

export const convertLead = defineAction({ schema: convertSchema, permission: "clients.create" }, async (input) => {
  const supabase = await createClient();
  const c = input.contract;
  const result = must(
    await supabase.rpc("convert_lead", {
      p_lead: input.leadId,
      p_deal: input.dealId,
      p_legal_name: input.legalName,
      p_document: input.document,
      p_billing_email: input.billingEmail,
      p_billing_phone: normalizePhone(input.billingPhone)?.e164 ?? "",
      p_contract: c
        ? {
            title: c.title,
            service_id: c.serviceId ?? "",
            description: c.description ?? "",
            amount_cents: c.amountCents,
            payment_method: c.paymentMethod,
            recurrence: c.recurrence,
            start_date: c.startDate,
            end_date: c.endDate ?? "",
            due_day: c.dueDay ?? "",
          }
        : null,
    }),
  ) as { client_id: string; contract_id: string | null };
  revalidateClients(result.client_id, input.leadId);
  return ok(result, "Lead convertido em cliente.");
});

export const updateClient = defineAction({ schema: clientUpdateSchema, permission: "clients.update" }, async (input) => {
  const supabase = await createClient();
  const res = must(
    await supabase
      .from("clients")
      .update({
        legal_name: input.legalName || null,
        document: input.document.replace(/\D/g, "") || null,
        billing_email: input.billingEmail.toLowerCase() || null,
        billing_phone_e164: normalizePhone(input.billingPhone)?.e164 ?? null,
        status: input.status,
        notes: input.notes || null,
      })
      .eq("id", input.id)
      .select("id, lead_id"),
  ) as { id: string; lead_id: string }[];
  if (!res.length) return fail("forbidden", "Você não pode editar este cliente.");
  revalidateClients(input.id, res[0].lead_id);
  return ok(null, "Cliente salvo.");
});

export const createContract = defineAction(
  { schema: contractFormSchema.and(z.object({ clientId: z.uuid() })), permission: "contracts.create" },
  async (input) => {
    const supabase = await createClient();
    const k = must(await supabase.from("contracts").insert({ ...contractRow(input), client_id: input.clientId }).select("id").single()) as { id: string };
    revalidateClients(input.clientId);
    return ok({ id: k.id }, "Contrato criado.");
  },
);

export const updateContract = defineAction({ schema: contractFormSchema.and(z.object({ id: z.uuid() })), permission: "contracts.update" }, async (input) => {
  const supabase = await createClient();
  const res = must(await supabase.from("contracts").update(contractRow(input)).eq("id", input.id).select("id, client_id")) as { client_id: string }[];
  if (!res.length) return fail("forbidden", "Você não pode editar este contrato.");
  revalidateClients(res[0].client_id);
  revalidatePath(`/contratos/${input.id}`);
  return ok(null, "Contrato salvo.");
});

export const deleteContract = defineAction({ schema: z.object({ id: z.uuid() }), permission: "contracts.delete" }, async ({ id }) => {
  const supabase = await createClient();
  const res = must(await supabase.from("contracts").update({ deleted_at: new Date().toISOString() }).eq("id", id).select("client_id")) as { client_id: string }[];
  if (!res.length) return fail("forbidden", "Você não pode excluir este contrato.");
  revalidateClients(res[0].client_id);
  return ok(null, "Contrato excluído.");
});

// --- Anexos --------------------------------------------------------------------

/**
 * Valida tipo/tamanho e devolve uma URL assinada de upload. O bucket e as
 * políticas do Storage repetem as mesmas regras (defesa em profundidade).
 */
export const requestUpload = defineAction({ schema: uploadRequestSchema }, async (input, { user }) => {
  if (!ATTACHMENT_TYPES[input.mimeType]) return fail("validation", "Tipo de arquivo não permitido. Use PDF, imagem, Word, Excel, CSV ou TXT.");
  if (input.size > ATTACHMENT_MAX_BYTES) return fail("validation", "Arquivo maior que 15 MB.");
  const safeName = input.fileName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\- ]+/g, "_").slice(-120);
  const path = `${user.organizationId}/${input.entityType}/${input.entityId}/${crypto.randomUUID()}-${safeName}`;
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("attachments").createSignedUploadUrl(path);
  if (error || !data) return fail("forbidden", "Você não pode anexar arquivos aqui.");
  return ok({ path, token: data.token });
});

export const registerAttachment = defineAction(
  { schema: uploadRequestSchema.extend({ path: z.string().max(400) }) },
  async (input, { user }) => {
    const prefix = `${user.organizationId}/${input.entityType}/${input.entityId}/`;
    if (!input.path.startsWith(prefix)) return fail("validation", "Caminho inválido.");
    const supabase = await createClient();
    must(
      await supabase.from("attachments").insert({
        entity_type: input.entityType,
        entity_id: input.entityId,
        storage_path: input.path,
        file_name: input.fileName,
        mime_type: input.mimeType,
        size_bytes: input.size,
      }),
    );
    return ok(null, "Arquivo anexado.");
  },
);

export const getAttachmentUrl = defineAction({ schema: z.object({ id: z.uuid() }) }, async ({ id }) => {
  const supabase = await createClient();
  const a = must(await supabase.from("attachments").select("storage_path, file_name").eq("id", id).single()) as { storage_path: string; file_name: string };
  const { data, error } = await supabase.storage.from("attachments").createSignedUrl(a.storage_path, 60, { download: a.file_name });
  if (error || !data) return fail("forbidden", "Não foi possível abrir o arquivo.");
  return ok({ url: data.signedUrl });
});

export const deleteAttachment = defineAction({ schema: z.object({ id: z.uuid() }) }, async ({ id }) => {
  const supabase = await createClient();
  const res = must(await supabase.from("attachments").update({ deleted_at: new Date().toISOString() }).eq("id", id).select("storage_path")) as { storage_path: string }[];
  if (!res.length) return fail("forbidden", "Só quem enviou o arquivo pode removê-lo.");
  await supabase.storage.from("attachments").remove([res[0].storage_path]);
  return ok(null, "Anexo removido.");
});

export const listEntityAttachments = defineAction({ schema: attachmentEntitySchema }, async (input) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("attachments")
    .select("id, file_name, mime_type, size_bytes, created_at, uploaded_by, storage_path")
    .eq("entity_type", input.entityType)
    .eq("entity_id", input.entityId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  return ok(data ?? []);
});
