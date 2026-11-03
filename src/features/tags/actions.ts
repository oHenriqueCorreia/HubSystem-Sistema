"use server";

import { revalidatePath } from "next/cache";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { fail, ok } from "@/domain/shared/result";
import type { Tag } from "@/features/crm/types";
import { z } from "zod";
import { tagArchiveSchema, tagIdSchema, tagSchema, tagUpdateSchema } from "./schemas";

function revalidateTags() {
  revalidatePath("/configuracoes/etiquetas");
  revalidatePath("/tarefas");
  revalidatePath("/crm", "layout");
}

// Quem cria tarefas ou edita leads pode criar etiquetas na hora; gerenciar
// (editar, arquivar, excluir) exige tags.manage. A RLS confirma as duas regras.
export const createTag = defineAction(
  { schema: tagSchema, permission: ["tags.manage", "crm.leads.update", "tasks.create", "inbox.reply"] },
  async (input) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("tags")
      .insert({ name: input.name, color: input.color, description: input.description || null })
      .select("id, name, color")
      .single();
    if (error?.code === "23505") return fail("conflict", "Já existe uma etiqueta com esse nome.");
    if (error) throw error;
    revalidateTags();
    return ok(data as Tag, "Etiqueta criada.");
  },
);

export const updateTag = defineAction({ schema: tagUpdateSchema, permission: ["tags.manage", "crm.pipeline.configure"] }, async (input) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tags")
    .update({ name: input.name, color: input.color, description: input.description || null })
    .eq("id", input.id)
    .select("id");
  if (error?.code === "23505") return fail("conflict", "Já existe uma etiqueta com esse nome.");
  if (error) throw error;
  if (!data?.length) return fail("forbidden", "Você não pode editar esta etiqueta.");
  revalidateTags();
  return ok(null, "Etiqueta salva.");
});

export const setTagArchived = defineAction({ schema: tagArchiveSchema, permission: ["tags.manage", "crm.pipeline.configure"] }, async (input) => {
  const supabase = await createClient();
  const res = must(
    await supabase.from("tags").update({ archived_at: input.archived ? new Date().toISOString() : null }).eq("id", input.id).select("id"),
  ) as { id: string }[];
  if (!res.length) return fail("forbidden", "Você não pode alterar esta etiqueta.");
  revalidateTags();
  return ok(null, input.archived ? "Etiqueta arquivada. Ela continua nos registros, mas não aparece para novos usos." : "Etiqueta reativada.");
});

/** Exclusão definitiva: remove a etiqueta de todos os registros (ação auditada). */
export const deleteTag = defineAction({ schema: tagIdSchema, permission: ["tags.manage", "crm.pipeline.configure"] }, async ({ id }) => {
  const supabase = await createClient();
  const res = must(await supabase.from("tags").delete().eq("id", id).select("id")) as { id: string }[];
  if (!res.length) return fail("forbidden", "Você não pode excluir esta etiqueta.");
  revalidateTags();
  return ok(null, "Etiqueta excluída.");
});

/** Etiquetas ativas para os seletores (carregadas quando o formulário abre). */
export const listActiveTags = defineAction({ schema: z.object({}) }, async () => {
  const supabase = await createClient();
  const data = must(await supabase.from("tags").select("id, name, color").is("archived_at", null).order("name")) as Tag[];
  return ok(data ?? []);
});
