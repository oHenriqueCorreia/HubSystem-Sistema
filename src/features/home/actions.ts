"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { ok } from "@/domain/shared/result";
import { HOME_WIDGETS } from "./queries";
import { searchCities } from "./weather";

const widgetKey = z.enum(HOME_WIDGETS.map((w) => w.key) as [string, ...string[]]);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida.");

/** Mescla uma parte nas preferências do próprio perfil. */
async function mergePreferences(userId: string, patch: (current: Record<string, unknown>) => Record<string, unknown>) {
  const supabase = await createClient();
  const current = must(await supabase.from("profiles").select("preferences").eq("id", userId).single()) as { preferences: Record<string, unknown> | null };
  must(await supabase.from("profiles").update({ preferences: patch(current.preferences ?? {}) }).eq("id", userId));
}

export const saveHomeLayout = defineAction(
  { schema: z.object({ hidden: z.array(widgetKey).max(20), order: z.array(widgetKey).max(20) }) },
  async (input, { user }) => {
    await mergePreferences(user.id, (p) => ({ ...p, home: { ...((p.home as object) ?? {}), hidden: input.hidden, order: input.order } }));
    revalidatePath("/inicio");
    return ok(null, "Tela inicial atualizada.");
  },
);

export const findCities = defineAction({ schema: z.object({ q: z.string().trim().min(2, "Digite ao menos 2 letras.").max(80) }) }, async ({ q }) => {
  return ok(await searchCities(q));
});

export const saveWeatherCity = defineAction(
  {
    schema: z.object({
      name: z.string().trim().min(2).max(120),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    }),
  },
  async (city, { user }) => {
    await mergePreferences(user.id, (p) => ({ ...p, home: { ...((p.home as object) ?? {}), city } }));
    revalidatePath("/inicio");
    return ok(null, `Clima de ${city.name}.`);
  },
);

export const saveWorkHours = defineAction(
  {
    schema: z
      .object({ start: time, end: time, days: z.array(z.number().int().min(0).max(6)).min(1, "Escolha ao menos um dia.").max(7) })
      .refine((v) => v.end > v.start, { path: ["end"], message: "O fim precisa ser depois do início." }),
  },
  async (input, { user }) => {
    await mergePreferences(user.id, (p) => ({ ...p, work_hours: { start: input.start, end: input.end, days: [...new Set(input.days)].sort() } }));
    revalidatePath("/configuracoes/perfil");
    return ok(null, "Expediente salvo. Ele define seus horários livres na agenda.");
  },
);
