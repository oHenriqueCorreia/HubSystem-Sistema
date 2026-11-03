"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { fail, ok } from "@/domain/shared/result";
import { TAG_COLORS } from "@/features/tags/schemas";

const stageFields = {
  name: z.string().trim().min(2, "Use pelo menos 2 caracteres.").max(60, "Use no máximo 60 caracteres."),
  color: z.enum(TAG_COLORS),
  kind: z.enum(["open", "won", "lost"]),
  slaDays: z.number().int().min(1).max(365).nullable().default(null),
};

const PERM = "crm.pipeline.configure" as const;
const done = () => {
  revalidatePath("/crm", "layout");
  revalidatePath("/dashboards/comercial");
};

export const createStage = defineAction({ schema: z.object({ pipelineId: z.uuid(), ...stageFields }), permission: PERM }, async (input) => {
  const supabase = await createClient();
  const { data: last } = await supabase.from("stages").select("position").eq("pipeline_id", input.pipelineId).order("position", { ascending: false }).limit(1).maybeSingle();
  must(
    await supabase.from("stages").insert({
      pipeline_id: input.pipelineId,
      name: input.name,
      color: input.color,
      kind: input.kind,
      sla_days: input.kind === "open" ? input.slaDays : null,
      position: (last?.position ?? -1) + 1,
    }),
  );
  done();
  return ok(null, "Etapa criada.");
});

export const updateStage = defineAction({ schema: z.object({ id: z.uuid(), ...stageFields }), permission: PERM }, async (input) => {
  const supabase = await createClient();
  const res = must(
    await supabase
      .from("stages")
      .update({ name: input.name, color: input.color, kind: input.kind, sla_days: input.kind === "open" ? input.slaDays : null })
      .eq("id", input.id)
      .select("id"),
  ) as { id: string }[];
  if (!res.length) return fail("forbidden", "Você não pode editar esta etapa.");
  done();
  return ok(null, "Etapa salva.");
});

export const reorderStages = defineAction({ schema: z.object({ pipelineId: z.uuid(), ids: z.array(z.uuid()).min(1).max(50) }), permission: PERM }, async (input) => {
  const supabase = await createClient();
  must(await supabase.rpc("reorder_stages", { p_pipeline: input.pipelineId, p_ids: input.ids }));
  done();
  return ok(null);
});

export const deleteStage = defineAction(
  { schema: z.object({ id: z.uuid(), targetId: z.uuid().nullable().default(null), archiveDeals: z.boolean().default(false) }), permission: PERM },
  async (input) => {
    const supabase = await createClient();
    const moved = must(await supabase.rpc("delete_stage", { p_stage: input.id, p_target: input.targetId, p_archive_deals: input.archiveDeals })) as number;
    done();
    if (!moved) return ok(null, "Etapa excluída.");
    return ok(null, input.targetId ? `Etapa excluída. ${moved} negócio(s) transferido(s).` : `Etapa excluída. ${moved} negócio(s) foram para a lixeira.`);
  },
);

export const createPipeline = defineAction({ schema: z.object({ name: z.string().trim().min(2, "Informe o nome.").max(60) }), permission: PERM }, async ({ name }) => {
  const supabase = await createClient();
  const id = must(await supabase.rpc("create_pipeline", { p_name: name })) as string;
  done();
  return ok({ id }, "Funil criado com etapas iniciais. Ajuste-as como preferir.");
});

export const renamePipeline = defineAction({ schema: z.object({ id: z.uuid(), name: z.string().trim().min(2, "Informe o nome.").max(60) }), permission: PERM }, async (input) => {
  const supabase = await createClient();
  must(await supabase.from("pipelines").update({ name: input.name }).eq("id", input.id));
  done();
  return ok(null, "Funil renomeado.");
});
