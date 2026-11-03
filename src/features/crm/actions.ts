"use server";

import { revalidatePath } from "next/cache";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { fail, ok } from "@/domain/shared/result";
import { normalizePhone } from "@/domain/shared/phone";
import {
  activitySchema,
  assignSchema,
  bulkAssignSchema,
  checkExistingSchema,
  dealValueSchema,
  idSchema,
  importSchema,
  leadFormSchema,
  leadTagsSchema,
  moveDealSchema,
  nextContactSchema,
  saveMappingSchema,
} from "./schemas";
import { z } from "zod";

function toLeadRow(input: z.output<typeof leadFormSchema>) {
  const phone = normalizePhone(input.phone);
  const whats = normalizePhone(input.whatsapp);
  return {
    name: input.name,
    company_name: input.company_name ?? null,
    phone_raw: input.phone || null,
    phone_e164: phone?.e164 ?? null,
    phone_type: phone?.type ?? null,
    whatsapp_e164: whats?.e164 ?? (phone?.type === "celular" ? phone.e164 : null),
    email: input.email || null,
    website: input.website ?? null,
    instagram: input.instagram ?? null,
    facebook: input.facebook ?? null,
    linkedin: input.linkedin ?? null,
    address: input.address ?? null,
    neighborhood: input.neighborhood ?? null,
    city: input.city ?? null,
    state: input.state || null,
    zip: input.zip ? input.zip.replace(/^(\d{5})-?(\d{3})$/, "$1-$2") : null,
    gmb_url: input.gmb_url ?? null,
    category: input.category ?? null,
    segment_id: input.segment_id ?? null,
    source: input.source ?? null,
    services_interest: input.services_interest,
    notes: input.notes ?? null,
  };
}

function revalidateCrm(leadId?: string) {
  revalidatePath("/crm/leads");
  revalidatePath("/crm/funil");
  if (leadId) revalidatePath(`/crm/leads/${leadId}`);
}

export const createLead = defineAction(
  { schema: leadFormSchema.extend({ pipelineId: z.uuid() }), permission: "crm.leads.create" },
  async (input) => {
    const supabase = await createClient();
    const row = toLeadRow(input);
    const lead = must(
      await supabase
        .from("leads")
        .insert({ ...row, source: row.source ?? "Cadastro manual", ...(input.owner_id ? { owner_id: input.owner_id } : {}) })
        .select("id, owner_id")
        .single(),
    ) as { id: string; owner_id: string | null };

    const stage = must(
      await supabase.from("stages").select("id").eq("pipeline_id", input.pipelineId).eq("kind", "open").order("position").limit(1).single(),
    ) as { id: string };
    must(
      await supabase
        .from("deals")
        .insert({ lead_id: lead.id, pipeline_id: input.pipelineId, stage_id: stage.id, owner_id: lead.owner_id, position: Date.now() / 1000 }),
    );
    must(await supabase.from("activities").insert({ lead_id: lead.id, type: "sistema", content: "Lead cadastrado" }));

    revalidateCrm();
    return ok({ id: lead.id }, "Lead cadastrado.");
  },
);

export const updateLead = defineAction(
  { schema: leadFormSchema.extend({ id: z.uuid() }), permission: "crm.leads.update" },
  async (input) => {
    const supabase = await createClient();
    const row = toLeadRow(input);
    const res = must(await supabase.from("leads").update(row).eq("id", input.id).select("id")) as { id: string }[];
    if (!res.length) return fail("forbidden", "Você não pode editar este lead.");
    revalidateCrm(input.id);
    return ok(null, "Lead salvo.");
  },
);

export const deleteLead = defineAction({ schema: idSchema, permission: "crm.leads.delete" }, async ({ id }) => {
  const supabase = await createClient();
  const res = must(
    await supabase.from("leads").update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id"),
  ) as { id: string }[];
  if (!res.length) return fail("forbidden", "Você não pode excluir este lead.");
  revalidateCrm();
  return ok(null, "Lead movido para a lixeira.");
});

export const restoreLead = defineAction({ schema: idSchema, permission: "crm.leads.delete" }, async ({ id }) => {
  const supabase = await createClient();
  must(await supabase.from("leads").update({ deleted_at: null, deleted_by: null }).eq("id", id));
  revalidateCrm(id);
  return ok(null, "Lead restaurado.");
});

export const assignLead = defineAction({ schema: assignSchema, permission: "crm.leads.assign" }, async (input) => {
  const supabase = await createClient();
  must(await supabase.from("leads").update({ owner_id: input.ownerId }).eq("id", input.leadId));
  must(await supabase.from("deals").update({ owner_id: input.ownerId }).eq("lead_id", input.leadId).is("deleted_at", null));
  revalidateCrm(input.leadId);
  return ok(null, "Responsável atualizado.");
});

export const bulkAssignLeads = defineAction({ schema: bulkAssignSchema, permission: "crm.leads.assign" }, async (input) => {
  const supabase = await createClient();
  must(await supabase.from("leads").update({ owner_id: input.ownerId }).in("id", input.leadIds));
  must(await supabase.from("deals").update({ owner_id: input.ownerId }).in("lead_id", input.leadIds).is("deleted_at", null));
  revalidateCrm();
  return ok(null, `${input.leadIds.length} lead(s) atribuído(s).`);
});

export const addActivity = defineAction({ schema: activitySchema, permission: "crm.leads.read" }, async (input) => {
  const supabase = await createClient();
  must(
    await supabase.from("activities").insert({
      lead_id: input.leadId,
      deal_id: input.dealId ?? null,
      type: input.type,
      content: input.content,
      occurred_at: input.occurredAt ?? new Date().toISOString(),
    }),
  );
  revalidateCrm(input.leadId);
  return ok(null, "Interação registrada.");
});

export const setNextContact = defineAction({ schema: nextContactSchema, permission: "crm.leads.update" }, async (input) => {
  const supabase = await createClient();
  const res = must(
    await supabase.from("leads").update({ next_contact_at: input.at }).eq("id", input.leadId).select("id"),
  ) as { id: string }[];
  if (!res.length) return fail("forbidden", "Você não pode alterar este lead.");
  revalidateCrm(input.leadId);
  return ok(null, input.at ? "Próximo contato agendado." : "Próximo contato removido.");
});

export const moveDeal = defineAction({ schema: moveDealSchema, permission: "crm.pipeline.move" }, async (input) => {
  const supabase = await createClient();
  must(
    await supabase.rpc("move_deal", {
      p_deal: input.dealId,
      p_stage: input.stageId,
      p_position: input.position,
      p_lost_reason: input.lostReasonId ?? null,
      p_lost_note: input.lostNote ?? null,
    }),
  );
  revalidatePath("/crm/funil");
  revalidatePath("/crm/leads");
  return ok(null, "Negócio movido.");
});

export const updateDealValue = defineAction({ schema: dealValueSchema, permission: "crm.leads.update" }, async (input) => {
  const supabase = await createClient();
  const deal = must(
    await supabase
      .from("deals")
      .update({ amount_cents: input.amountCents, billing: input.billing, expected_close_date: input.expectedCloseDate })
      .eq("id", input.dealId)
      .select("lead_id")
      .single(),
  ) as { lead_id: string };
  revalidateCrm(deal.lead_id);
  return ok(null, "Valores do negócio salvos.");
});

export const startDealInPipeline = defineAction(
  { schema: z.object({ leadId: z.uuid(), pipelineId: z.uuid() }), permission: "crm.leads.update" },
  async (input) => {
    const supabase = await createClient();
    const stage = must(
      await supabase.from("stages").select("id").eq("pipeline_id", input.pipelineId).eq("kind", "open").order("position").limit(1).single(),
    ) as { id: string };
    const { error } = await supabase
      .from("deals")
      .insert({ lead_id: input.leadId, pipeline_id: input.pipelineId, stage_id: stage.id, position: Date.now() / 1000 });
    if (error?.code === "23505") return fail("conflict", "Este lead já está neste funil.");
    if (error) throw error;
    revalidateCrm(input.leadId);
    return ok(null, "Lead adicionado ao funil.");
  },
);

export const setLeadTags = defineAction({ schema: leadTagsSchema, permission: "crm.leads.update" }, async (input) => {
  const supabase = await createClient();
  must(await supabase.from("lead_tags").delete().eq("lead_id", input.leadId));
  if (input.tagIds.length) {
    must(await supabase.from("lead_tags").insert(input.tagIds.map((tag_id) => ({ lead_id: input.leadId, tag_id }))));
  }
  revalidateCrm(input.leadId);
  return ok(null, "Etiquetas atualizadas.");
});

// --- Importação --------------------------------------------------------------

export const checkExistingLeads = defineAction({ schema: checkExistingSchema, permission: "crm.leads.import" }, async (input) => {
  const supabase = await createClient();
  const data = must(
    await supabase.rpc("find_existing_leads", {
      p_place_ids: input.placeIds,
      p_phones: input.phones,
      p_emails: input.emails.map((e) => e.toLowerCase()),
    }),
  ) as { id: string; name: string; place_id: string | null; phone_e164: string | null; email: string | null }[];
  return ok(data ?? []);
});

export const importLeads = defineAction({ schema: importSchema, permission: "crm.leads.import" }, async (input) => {
  const supabase = await createClient();
  const result = must(
    await supabase.rpc("import_leads", {
      p_file_name: input.fileName,
      p_rows: input.rows,
      p_pipeline: input.pipelineId,
      p_mode: input.mode,
      p_segment_name: input.segmentName,
    }),
  ) as { import_id: string; inserted: number; updated: number; skipped: number; invalid: number; errors: { linha: number; erro: string }[] };
  revalidateCrm();
  return ok(result, `${result.inserted} lead(s) importado(s).`);
});

export const undoImport = defineAction({ schema: idSchema, permission: "crm.leads.import" }, async ({ id }) => {
  const supabase = await createClient();
  const count = must(await supabase.rpc("undo_import", { p_import: id })) as number;
  revalidateCrm();
  revalidatePath("/crm/importar");
  return ok(null, `Importação desfeita: ${count} lead(s) removido(s).`);
});

export const saveImportMapping = defineAction({ schema: saveMappingSchema, permission: "crm.leads.import" }, async (input) => {
  const supabase = await createClient();
  must(
    await supabase
      .from("import_mappings")
      .upsert({ signature: input.signature, mapping: input.mapping, updated_at: new Date().toISOString() }, { onConflict: "organization_id,signature" }),
  );
  return ok(null);
});

export const getImportMapping = defineAction({ schema: saveMappingSchema.pick({ signature: true }), permission: "crm.leads.import" }, async (input) => {
  const supabase = await createClient();
  const { data } = await supabase.from("import_mappings").select("mapping").eq("signature", input.signature).maybeSingle();
  return ok((data?.mapping as Record<string, string> | undefined) ?? null);
});

export const searchLeads = defineAction(
  { schema: z.object({ q: z.string().trim().max(100) }), permission: "crm.leads.read" },
  async ({ q }) => {
    const supabase = await createClient();
    let query = supabase.from("leads").select("id, name, city").is("deleted_at", null).order("name").limit(12);
    if (q) query = query.ilike("name", `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    const data = must(await query) as { id: string; name: string; city: string | null }[];
    return ok(data ?? []);
  },
);

export const lgpdAnonymize = defineAction(
  { schema: z.object({ leadId: z.uuid(), reason: z.string().trim().min(5, "Informe o motivo.").max(300) }), permission: "admin.data_export" },
  async (input) => {
    const supabase = await createClient();
    must(await supabase.rpc("lgpd_anonymize_lead", { p_lead: input.leadId, p_reason: input.reason }));
    revalidateCrm(input.leadId);
    return ok(null, "Dados pessoais anonimizados.");
  },
);
