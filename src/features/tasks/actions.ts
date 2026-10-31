"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { fail, ok } from "@/domain/shared/result";
import { zonedIso } from "@/domain/calendar";
import {
  cadenceTemplateSchema,
  checklistAddSchema,
  checklistToggleSchema,
  commentSchema,
  enrollSchema,
  eventFormSchema,
  idSchema,
  taskFormSchema,
  taskMoveSchema,
  taskStatusSchema,
} from "./schemas";

function revalidateWork(leadId?: string | null) {
  revalidatePath("/tarefas");
  revalidatePath("/inicio");
  revalidatePath("/agenda");
  if (leadId) revalidatePath(`/crm/leads/${leadId}`);
}

function taskRow(input: z.output<typeof taskFormSchema>) {
  const dueAt = input.dueDate ? zonedIso(input.dueDate, input.dueTime ?? "23:59") : null;
  return {
    title: input.title,
    description: input.description || null,
    priority: input.priority,
    status: input.status,
    start_date: input.startDate || null,
    due_at: dueAt,
    has_time: Boolean(input.dueDate && input.dueTime),
    duration_minutes: input.dueTime ? (input.durationMinutes ?? 30) : null,
    category: input.category || null,
    lead_id: input.leadId ?? null,
    channel: input.channel ?? null,
    ...(input.ownerId ? { owner_id: input.ownerId } : {}),
  };
}

export const createTask = defineAction({ schema: taskFormSchema, permission: "tasks.create" }, async (input) => {
  const supabase = await createClient();
  const task = must(await supabase.from("tasks").insert({ ...taskRow(input), position: Date.now() / 1000 }).select("id").single()) as { id: string };
  if (input.checklist.length) {
    must(await supabase.from("task_checklist_items").insert(input.checklist.map((title, i) => ({ task_id: task.id, title, position: i * 1024 }))));
  }
  revalidateWork(input.leadId);
  return ok({ id: task.id }, "Tarefa criada.");
});

export const updateTask = defineAction({ schema: taskFormSchema.and(z.object({ id: z.uuid() })), permission: "tasks.update" }, async (input) => {
  const supabase = await createClient();
  const { checklist: _ignored, ...rest } = input;
  void _ignored;
  const res = must(await supabase.from("tasks").update(taskRow({ ...rest, checklist: [] })).eq("id", input.id).select("id")) as { id: string }[];
  if (!res.length) return fail("forbidden", "Você não pode editar esta tarefa.");
  revalidateWork(input.leadId);
  return ok(null, "Tarefa salva.");
});

export const setTaskStatus = defineAction({ schema: taskStatusSchema, permission: "tasks.update" }, async (input) => {
  const supabase = await createClient();
  const res = must(
    await supabase
      .from("tasks")
      .update({ status: input.status, ...(input.outcome !== undefined ? { outcome: input.outcome || null } : {}) })
      .eq("id", input.id)
      .select("id, lead_id"),
  ) as { id: string; lead_id: string | null }[];
  if (!res.length) return fail("forbidden", "Você não pode alterar esta tarefa.");
  revalidateWork(res[0].lead_id);
  return ok(null, input.status === "concluida" ? "Tarefa concluída." : "Tarefa atualizada.");
});

export const moveTask = defineAction({ schema: taskMoveSchema, permission: "tasks.update" }, async (input) => {
  const supabase = await createClient();
  must(await supabase.from("tasks").update({ status: input.status, position: input.position }).eq("id", input.id));
  revalidateWork();
  return ok(null);
});

export const deleteTask = defineAction({ schema: idSchema, permission: "tasks.delete" }, async ({ id }) => {
  const supabase = await createClient();
  const res = must(await supabase.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id, lead_id")) as { lead_id: string | null }[];
  if (!res.length) return fail("forbidden", "Você não pode excluir esta tarefa.");
  revalidateWork(res[0].lead_id);
  return ok(null, "Tarefa excluída.");
});

export const restoreTask = defineAction({ schema: idSchema, permission: "tasks.delete" }, async ({ id }) => {
  const supabase = await createClient();
  must(await supabase.from("tasks").update({ deleted_at: null }).eq("id", id));
  revalidateWork();
  return ok(null, "Tarefa restaurada.");
});

export const addChecklistItem = defineAction({ schema: checklistAddSchema, permission: "tasks.read" }, async (input) => {
  const supabase = await createClient();
  const item = must(await supabase.from("task_checklist_items").insert({ task_id: input.taskId, title: input.title, position: Date.now() / 1000 }).select("id, title, position, done_at").single());
  revalidateWork();
  return ok(item as { id: string; title: string; position: number; done_at: string | null });
});

export const toggleChecklistItem = defineAction({ schema: checklistToggleSchema, permission: "tasks.read" }, async (input) => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  must(
    await supabase
      .from("task_checklist_items")
      .update({ done_at: input.done ? new Date().toISOString() : null, done_by: input.done ? claims?.claims?.sub : null })
      .eq("id", input.id),
  );
  revalidateWork();
  return ok(null);
});

export const deleteChecklistItem = defineAction({ schema: idSchema, permission: "tasks.read" }, async ({ id }) => {
  const supabase = await createClient();
  must(await supabase.from("task_checklist_items").delete().eq("id", id));
  revalidateWork();
  return ok(null);
});

export const addComment = defineAction({ schema: commentSchema, permission: "tasks.read" }, async (input) => {
  const supabase = await createClient();
  must(await supabase.from("task_comments").insert({ task_id: input.taskId, body: input.body }));
  revalidatePath(`/tarefas/${input.taskId}`);
  return ok(null, "Comentário adicionado.");
});

// --- Agenda --------------------------------------------------------------------

function eventRow(input: z.output<typeof eventFormSchema>) {
  const starts = input.allDay ? zonedIso(input.date, "00:00") : zonedIso(input.date, input.startTime);
  const ends = input.allDay ? zonedIso(input.date, "23:59") : zonedIso(input.date, input.endTime);
  return {
    title: input.title,
    description: input.description || null,
    kind: input.kind,
    starts_at: starts,
    ends_at: ends,
    all_day: input.allDay,
    location: input.location || null,
    meet_url: input.meetUrl || null,
    lead_id: input.leadId ?? null,
    reminder_minutes: input.reminderMinutes != null ? [input.reminderMinutes] : [],
    ...(input.ownerId ? { owner_id: input.ownerId } : {}),
  };
}

async function syncAttendees(eventId: string, ids: string[]) {
  const supabase = await createClient();
  must(await supabase.from("event_attendees").delete().eq("event_id", eventId));
  if (ids.length) must(await supabase.from("event_attendees").insert(ids.map((user_id) => ({ event_id: eventId, user_id }))));
}

export const createEvent = defineAction({ schema: eventFormSchema, permission: "calendar.manage" }, async (input) => {
  const supabase = await createClient();
  const ev = must(await supabase.from("calendar_events").insert(eventRow(input)).select("id").single()) as { id: string };
  await syncAttendees(ev.id, input.attendeeIds);
  if (input.leadId) {
    must(
      await supabase.from("activities").insert({
        lead_id: input.leadId,
        type: "reuniao",
        content: `Agendado: ${input.title}`,
        occurred_at: new Date().toISOString(),
        metadata: { event_id: ev.id },
      }),
    );
  }
  revalidateWork(input.leadId);
  return ok({ id: ev.id }, "Evento criado.");
});

export const updateEvent = defineAction({ schema: eventFormSchema.and(z.object({ id: z.uuid() })), permission: "calendar.manage" }, async (input) => {
  const supabase = await createClient();
  const res = must(await supabase.from("calendar_events").update(eventRow(input)).eq("id", input.id).select("id")) as { id: string }[];
  if (!res.length) return fail("forbidden", "Você não pode editar este evento.");
  await syncAttendees(input.id, input.attendeeIds);
  revalidateWork(input.leadId);
  return ok(null, "Evento salvo.");
});

export const deleteEvent = defineAction({ schema: idSchema, permission: "calendar.manage" }, async ({ id }) => {
  const supabase = await createClient();
  const res = must(await supabase.from("calendar_events").update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id, lead_id")) as { lead_id: string | null }[];
  if (!res.length) return fail("forbidden", "Você não pode excluir este evento.");
  revalidateWork(res[0].lead_id);
  return ok(null, "Evento excluído.");
});

export const restoreEvent = defineAction({ schema: idSchema, permission: "calendar.manage" }, async ({ id }) => {
  const supabase = await createClient();
  must(await supabase.from("calendar_events").update({ deleted_at: null }).eq("id", id));
  revalidateWork();
  return ok(null, "Evento restaurado.");
});

// --- Cadências ---------------------------------------------------------------

export const saveCadence = defineAction({ schema: cadenceTemplateSchema, permission: "crm.cadences.manage" }, async (input) => {
  const supabase = await createClient();
  let id = input.id;
  if (id) {
    must(await supabase.from("cadence_templates").update({ name: input.name, description: input.description, is_active: input.isActive }).eq("id", id));
    // Etapas usadas por tarefas existentes ficam desvinculadas (set null), sem perder as tarefas.
    must(await supabase.from("cadence_steps").delete().eq("template_id", id));
  } else {
    const t = must(await supabase.from("cadence_templates").insert({ name: input.name, description: input.description, is_active: input.isActive }).select("id").single()) as { id: string };
    id = t.id;
  }
  must(
    await supabase.from("cadence_steps").insert(
      input.steps.map((s, i) => ({
        template_id: id,
        position: i,
        day_offset: s.dayOffset,
        time_of_day: s.timeOfDay,
        channel: s.channel,
        title: s.title,
        instruction: s.instruction,
        message: s.message,
      })),
    ),
  );
  revalidatePath("/crm/cadencias");
  return ok({ id: id! }, "Cadência salva.");
});

export const enrollLead = defineAction({ schema: enrollSchema, permission: "tasks.create" }, async (input) => {
  const supabase = await createClient();
  must(await supabase.rpc("enroll_cadence", { p_lead: input.leadId, p_template: input.templateId, p_start: input.startDate ?? null }));
  revalidateWork(input.leadId);
  return ok(null, "Cadência iniciada. As tarefas foram criadas.");
});

export const cancelEnrollment = defineAction({ schema: idSchema.extend({ leadId: z.uuid() }), permission: "tasks.update" }, async (input) => {
  const supabase = await createClient();
  must(await supabase.rpc("cancel_enrollment", { p_enrollment: input.id }));
  revalidateWork(input.leadId);
  return ok(null, "Cadência cancelada. As tarefas pendentes foram canceladas.");
});
