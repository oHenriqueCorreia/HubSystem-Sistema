"use server";

import { defineAction } from "@/lib/actions";
import { fail, ok } from "@/domain/shared/result";
import { getEvent, getTask } from "./queries";
import { idSchema } from "./schemas";

/** Leituras sob demanda chamadas por componentes de cliente (painéis). */
export const getTaskDetails = defineAction({ schema: idSchema, permission: "tasks.read" }, async ({ id }) => {
  const data = await getTask(id);
  if (!data) return fail("not_found", "Tarefa não encontrada.");
  return ok(data);
});

export const getEventDetails = defineAction({ schema: idSchema, permission: "calendar.read" }, async ({ id }) => {
  const data = await getEvent(id);
  if (!data) return fail("not_found", "Evento não encontrado.");
  return ok(data);
});
