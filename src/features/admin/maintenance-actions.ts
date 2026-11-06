"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { ok } from "@/domain/shared/result";

function refresh() {
  revalidatePath("/configuracoes/manutencao");
  revalidatePath("/crm", "layout");
}

/** A confirmação acontece na tela; o banco ainda exige a palavra CORRIGIR e guarda cópia de cada texto. */
export const applyEncodingFix = defineAction({ schema: z.object({}), permission: "admin.settings" }, async () => {
  const supabase = await createClient();
  const batch = must(await supabase.rpc("admin_encoding_apply", { p_confirm: "CORRIGIR" })) as string;
  refresh();
  return ok({ batch }, "Acentuação corrigida. Se algo ficou errado, use Desfazer.");
});

export const revertEncodingFix = defineAction({ schema: z.object({ batchId: z.uuid() }), permission: "admin.settings" }, async ({ batchId }) => {
  const supabase = await createClient();
  const n = must(await supabase.rpc("admin_encoding_revert", { p_batch: batchId })) as number;
  refresh();
  return ok({ restored: n }, `${n} texto(s) voltaram ao que eram antes.`);
});
