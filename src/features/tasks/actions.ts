"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { fail, ok } from "@/domain/shared/result";
import { DEFAULT_WORK_HOURS, freeSlots, mergeIntervals, zonedIso, type Interval, type WorkHours } from "@/domain/calendar";
import { googleBusy, syncUserQuietly } from "@/lib/google/calendar";
import { runCadences } from "@/lib/cadence-runner";
import { RATE_LIMIT_MESSAGE, withinRateLimit } from "@/lib/rate-limit";
import {
  availabilitySchema,
  cadenceTemplateSchema,
  checklistAddSchema,
  checklistToggleSchema,
  commentSchema,
  enrollSchema,
  enrollmentStatusSchema,
  eventFormSchema,
  idSchema,
  taskFormSchema,
  taskColumnDeleteSchema,
  taskColumnMoveSchema,
  taskColumnSchema,
  taskColumnUpdateSchema,
  taskMoveSchema,
  taskStatusSchema,
} from "./schemas";

/** Leva a alteração ao Google Agenda do responsável sem atrasar a resposta. */
function syncGoogleLater(userId: string | null | undefined) {
  if (userId) after(() => syncUserQuietly(userId));
}

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
    ...(input.columnId ? { column_id: input.columnId } : {}),
  };
}

/** Substitui etiquetas e participantes da tarefa pelos informados. */
async function syncTaskLinks(taskId: string, tagIds: string[], participantIds: string[]) {
  const supabase = await createClient();
  must(await supabase.from("task_tags").delete().eq("task_id", taskId));
  if (tagIds.length) must(await supabase.from("task_tags").insert([...new Set(tagIds)].map((tag_id) => ({ task_id: taskId, tag_id }))));
  must(await supabase.from("task_participants").delete().eq("task_id", taskId));
  if (participantIds.length) {
    must(await supabase.from("task_participants").insert([...new Set(participantIds)].map((user_id) => ({ task_id: taskId, user_id }))));
  }
}

export const createTask = defineAction({ schema: taskFormSchema, permission: "tasks.create" }, async (input, { user }) => {
  const supabase = await createClient();
  const task = must(await supabase.from("tasks").insert({ ...taskRow(input), position: Date.now() / 1000 }).select("id").single()) as { id: string };
  if (input.checklist.length) {
    must(await supabase.from("task_checklist_items").insert(input.checklist.map((title, i) => ({ task_id: task.id, title, position: i * 1024 }))));
  }
  await syncTaskLinks(task.id, input.tagIds, input.participantIds);
  if (input.dueDate) syncGoogleLater(input.ownerId ?? user.id);
  revalidateWork(input.leadId);
  return ok({ id: task.id }, "Tarefa criada.");
});

export const updateTask = defineAction({ schema: taskFormSchema.and(z.object({ id: z.uuid() })), permission: "tasks.update" }, async (input, { user }) => {
  const supabase = await createClient();
  const { checklist: _ignored, ...rest } = input;
  void _ignored;
  const res = must(await supabase.from("tasks").update(taskRow({ ...rest, checklist: [] })).eq("id", input.id).select("id, owner_id")) as { id: string; owner_id: string | null }[];
  if (!res.length) return fail("forbidden", "Você não pode editar esta tarefa.");
  await syncTaskLinks(input.id, input.tagIds, input.participantIds);
  syncGoogleLater(res[0].owner_id ?? user.id);
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
      .select("id, lead_id, owner_id"),
  ) as { id: string; lead_id: string | null; owner_id: string | null }[];
  if (!res.length) return fail("forbidden", "Você não pode alterar esta tarefa.");
  syncGoogleLater(res[0].owner_id);
  revalidateWork(res[0].lead_id);
  return ok(null, input.status === "concluida" ? "Tarefa concluída." : "Tarefa atualizada.");
});

export const moveTask = defineAction({ schema: taskMoveSchema, permission: "tasks.update" }, async (input) => {
  const supabase = await createClient();
  // O status acompanha a coluna (trigger tasks_column_sync no banco).
  const changed = must(await supabase.from("tasks").update({ column_id: input.columnId, position: input.position }).eq("id", input.id).select("id, lead_id, owner_id")) as { id: string; lead_id: string | null; owner_id: string | null }[];
  if (!changed.length) return fail("forbidden", "Você não pode mover esta tarefa.");
  syncGoogleLater(changed[0].owner_id);
  revalidateWork(changed[0].lead_id);
  return ok(null);
});

export const deleteTask = defineAction({ schema: idSchema, permission: "tasks.delete" }, async ({ id }) => {
  const supabase = await createClient();
  const res = must(await supabase.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id, lead_id, owner_id")) as { lead_id: string | null; owner_id: string | null }[];
  if (!res.length) return fail("forbidden", "Você não pode excluir esta tarefa.");
  syncGoogleLater(res[0].owner_id);
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
    send_updates: input.sendUpdates,
    ...(input.ownerId ? { owner_id: input.ownerId } : {}),
  };
}

async function syncAttendees(eventId: string, ids: string[]) {
  const supabase = await createClient();
  must(await supabase.from("event_attendees").delete().eq("event_id", eventId));
  if (ids.length) must(await supabase.from("event_attendees").insert(ids.map((user_id) => ({ event_id: eventId, user_id }))));
}

/** Convidados por e-mail: mantém quem continua (e a resposta já dada), remove quem saiu. */
async function syncGuests(eventId: string, guests: z.output<typeof eventFormSchema>["guests"]) {
  const supabase = await createClient();
  const unique = [...new Map(guests.map((g) => [g.email, g])).values()];
  const { data: current } = await supabase.from("event_guests").select("id, email").eq("event_id", eventId);
  const removed = (current ?? []).filter((c) => !unique.some((g) => g.email === c.email)).map((c) => c.id);
  if (removed.length) must(await supabase.from("event_guests").delete().in("id", removed));
  if (unique.length) {
    must(
      await supabase
        .from("event_guests")
        .upsert(unique.map((g) => ({ event_id: eventId, email: g.email, name: g.name, optional: g.optional })), { onConflict: "event_id,email" }),
    );
  }
}

export const createEvent = defineAction({ schema: eventFormSchema, permission: "calendar.manage" }, async (input, { user }) => {
  const supabase = await createClient();
  const ev = must(await supabase.from("calendar_events").insert(eventRow(input)).select("id").single()) as { id: string };
  await syncAttendees(ev.id, input.attendeeIds);
  await syncGuests(ev.id, input.guests);
  syncGoogleLater(input.ownerId ?? user.id);
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

export const updateEvent = defineAction({ schema: eventFormSchema.and(z.object({ id: z.uuid() })), permission: "calendar.manage" }, async (input, { user }) => {
  const supabase = await createClient();
  const res = must(await supabase.from("calendar_events").update(eventRow(input)).eq("id", input.id).select("id, owner_id")) as { id: string; owner_id: string | null }[];
  if (!res.length) return fail("forbidden", "Você não pode editar este evento.");
  await syncAttendees(input.id, input.attendeeIds);
  await syncGuests(input.id, input.guests);
  syncGoogleLater(res[0].owner_id ?? user.id);
  revalidateWork(input.leadId);
  return ok(null, "Evento salvo.");
});

export const deleteEvent = defineAction({ schema: idSchema, permission: "calendar.manage" }, async ({ id }) => {
  const supabase = await createClient();
  const res = must(await supabase.from("calendar_events").update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id, lead_id, owner_id")) as { lead_id: string | null; owner_id: string | null }[];
  if (!res.length) return fail("forbidden", "Você não pode excluir este evento.");
  syncGoogleLater(res[0].owner_id);
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

function templateRow(input: z.output<typeof cadenceTemplateSchema>) {
  return {
    name: input.name,
    description: input.description,
    is_active: input.isActive,
    require_consent: input.requireConsent,
    send_window: { start: input.windowStart, end: input.windowEnd, days: [1, 2, 3, 4, 5] },
  };
}

export const saveCadence = defineAction({ schema: cadenceTemplateSchema, permission: "crm.cadences.manage" }, async (input) => {
  const supabase = await createClient();
  let id = input.id;
  if (id) {
    must(await supabase.from("cadence_templates").update({ ...templateRow(input) }).eq("id", id));
    // Etapas usadas por tarefas existentes ficam desvinculadas (set null), sem perder as tarefas.
    must(await supabase.from("cadence_steps").delete().eq("template_id", id));
  } else {
    const t = must(await supabase.from("cadence_templates").insert({ ...templateRow(input) }).select("id").single()) as { id: string };
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
        auto_send: s.autoSend,
        whatsapp_template: s.channel === "whatsapp" && s.autoSend ? s.whatsappTemplate : null,
        template_language: s.templateLanguage || "pt_BR",
        add_tag_id: s.addTagId,
        move_to_stage_id: s.moveToStageId,
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

// --- Quadro: colunas -------------------------------------------------------------

export const createTaskColumn = defineAction({ schema: taskColumnSchema, permission: "tasks.board.configure" }, async (input) => {
  const supabase = await createClient();
  const { data: last } = await supabase.from("task_columns").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
  must(await supabase.from("task_columns").insert({ ...input, position: (last?.position ?? 0) + 1024 }));
  revalidatePath("/tarefas");
  return ok(null, "Coluna criada.");
});

export const updateTaskColumn = defineAction({ schema: taskColumnUpdateSchema, permission: "tasks.board.configure" }, async ({ id, ...input }) => {
  const supabase = await createClient();
  const res = must(await supabase.from("task_columns").update(input).eq("id", id).select("id")) as { id: string }[];
  if (!res.length) return fail("forbidden", "Você não pode editar esta coluna.");
  // Tarefas da coluna passam a seguir o novo status-base.
  must(await supabase.from("tasks").update({ status: input.kind }).eq("column_id", id).neq("status", input.kind).is("deleted_at", null));
  revalidateWork();
  return ok(null, "Coluna salva.");
});

export const moveTaskColumn = defineAction({ schema: taskColumnMoveSchema, permission: "tasks.board.configure" }, async (input) => {
  const supabase = await createClient();
  must(await supabase.from("task_columns").update({ position: input.position }).eq("id", input.id));
  revalidatePath("/tarefas");
  return ok(null);
});

export const archiveTaskColumn = defineAction({ schema: idSchema, permission: "tasks.board.configure" }, async ({ id }) => {
  const supabase = await createClient();
  const { count } = await supabase.from("tasks").select("id", { count: "exact", head: true }).eq("column_id", id).is("deleted_at", null);
  if (count) return fail("business_rule", "Mova as tarefas desta coluna antes de arquivá-la.");
  must(await supabase.from("task_columns").update({ archived_at: new Date().toISOString() }).eq("id", id));
  revalidatePath("/tarefas");
  return ok(null, "Coluna arquivada.");
});

export const deleteTaskColumn = defineAction({ schema: taskColumnDeleteSchema, permission: "tasks.board.configure" }, async (input) => {
  const supabase = await createClient();
  const moved = must(
    await supabase.rpc("delete_task_column", { p_column: input.id, p_target: input.targetId, p_archive_tasks: input.archiveTasks }),
  ) as number;
  revalidateWork();
  if (!moved) return ok(null, "Coluna excluída.");
  return ok(null, input.targetId ? `Coluna excluída. ${moved} tarefa(s) transferida(s).` : `Coluna excluída. ${moved} tarefa(s) foram para a lixeira.`);
});

// --- Dependências e histórico ---------------------------------------------------

export type TaskHistoryEntry = { created_at: string; action: string; actor_name: string; changes: Record<string, unknown> };

export const getTaskHistory = defineAction({ schema: idSchema, permission: "tasks.read" }, async ({ id }) => {
  const supabase = await createClient();
  const rows = must(await supabase.rpc("task_history", { p_task: id })) as TaskHistoryEntry[];
  return ok(rows ?? []);
});

// --- Disponibilidade ---------------------------------------------------------------

export type Availability = { busy: Interval[]; free: Interval[]; source: "google" | "interno"; workHours: WorkHours };

/**
 * Horários ocupados e livres de um dia (expediente da pessoa, fuso de São Paulo).
 * Usa o Google (FreeBusy: só livre/ocupado, sem títulos) e a agenda interna.
 */
export const getAvailability = defineAction({ schema: availabilitySchema, permission: "calendar.read" }, async (input, { user }) => {
  const supabase = await createClient();
  const ownerId = input.ownerId ?? user.id;
  const start = zonedIso(input.date, "00:00");
  const end = zonedIso(input.date, "23:59");
  const [events, tasks, profile] = await Promise.all([
    supabase.from("calendar_events").select("starts_at, ends_at").eq("owner_id", ownerId).is("deleted_at", null).eq("all_day", false).lt("starts_at", end).gt("ends_at", start),
    supabase
      .from("tasks")
      .select("due_at, duration_minutes")
      .eq("owner_id", ownerId)
      .is("deleted_at", null)
      .eq("has_time", true)
      .in("status", ["a_fazer", "em_andamento"])
      .gte("due_at", start)
      .lte("due_at", end),
    supabase.from("profiles").select("preferences").eq("id", ownerId).maybeSingle(),
  ]);
  const internal: Interval[] = [
    ...(events.data ?? []).map((e) => ({ start: e.starts_at, end: e.ends_at })),
    ...(tasks.data ?? []).map((t) => ({ start: t.due_at, end: new Date(new Date(t.due_at).getTime() + (t.duration_minutes ?? 30) * 60_000).toISOString() })),
  ];
  // O Google só é consultado para a própria agenda (cada pessoa conecta a sua).
  const google = ownerId === user.id ? await googleBusy(ownerId, start, end).catch(() => null) : null;
  const prefs = (profile.data?.preferences ?? {}) as { work_hours?: WorkHours };
  const workHours = prefs.work_hours ?? DEFAULT_WORK_HOURS;
  const busy = mergeIntervals([...internal, ...(google ?? [])]);
  return ok<Availability>({ busy, free: freeSlots(input.date, busy, workHours, input.minutes), source: google ? "google" : "interno", workHours });
});

// --- Cadências: controle por contato e execução manual -----------------------------

export const setEnrollmentStatus = defineAction({ schema: enrollmentStatusSchema, permission: "tasks.update" }, async (input) => {
  const supabase = await createClient();
  must(await supabase.rpc("set_enrollment_status", { p_enrollment: input.id, p_status: input.status }));
  revalidateWork(input.leadId);
  return ok(null, input.status === "ativa" ? "Cadência retomada." : input.status === "pausada" ? "Cadência pausada para este contato." : "Contato removido da cadência.");
});

/** Executa agora as etapas automáticas vencidas da organização (além do cron diário). */
export const runCadencesNow = defineAction({ schema: z.object({}), permission: "crm.cadences.manage" }, async (_input, { user }) => {
  if (!process.env.SUPABASE_SECRET_KEY) return fail("business_rule", "Automação indisponível: falta SUPABASE_SECRET_KEY no servidor.");
  if (!(await withinRateLimit(`cadences:${user.organizationId}`, 12, 3600))) return fail("business_rule", RATE_LIMIT_MESSAGE);
  const r = await runCadences(user.organizationId);
  revalidatePath("/crm/cadencias");
  return ok(r, `Processado: ${r.enviados} enviado(s), ${r.executados} ação(ões), ${r.bloqueados} bloqueado(s), ${r.erros} erro(s), ${r.aguardando} aguardando horário.`);
});
