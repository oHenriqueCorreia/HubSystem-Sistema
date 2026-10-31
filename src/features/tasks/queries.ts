import "server-only";
import { createClient } from "@/lib/supabase/server";
import { todayLocal } from "@/domain/shared/dates";
import type { CalItem } from "@/domain/calendar";
import type { Task, TaskColumn, TaskComment } from "./types";

const TASK_COLUMNS = `
  id, title, description, owner_id, priority, status, start_date, due_at, has_time, duration_minutes, category,
  position, lead_id, deal_id, channel, suggested_message, outcome, completed_at, created_by, created_at, cadence_enrollment_id, column_id,
  lead:leads(id, name, whatsapp_e164),
  checklist:task_checklist_items(id, title, position, done_at),
  task_tags(tag:tags(id, name, color)),
  task_participants(user_id)
`;

type Row = Record<string, unknown>;

function toTask(r: Row): Task {
  const lead = Array.isArray(r.lead) ? r.lead[0] : r.lead;
  const tags = ((r.task_tags as { tag: Task["tags"][number] | null }[] | null) ?? []).flatMap((t) => (t.tag ? [t.tag] : []));
  return {
    ...(r as unknown as Task),
    lead: (lead as Task["lead"]) ?? null,
    checklist: ((r.checklist as Task["checklist"]) ?? []).sort((a, b) => a.position - b.position),
    tags,
    participant_ids: ((r.task_participants as { user_id: string }[] | null) ?? []).map((p) => p.user_id),
  };
}

/** Colunas ativas do quadro, na ordem definida pela organização. */
export async function listTaskColumns(): Promise<TaskColumn[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("task_columns").select("id, name, color, kind, position, archived_at").is("archived_at", null).order("position");
  if (error) throw error;
  return (data ?? []) as TaskColumn[];
}

export type TaskFilters = {
  tag?: string;
  responsavel?: string;
  status?: "abertas" | "concluidas" | "todas";
  prioridade?: string;
  q?: string;
  lead?: string;
  periodo?: "atrasadas" | "hoje" | "semana" | "sem_prazo";
};

export async function listTasks(filters: TaskFilters, limit = 500): Promise<Task[]> {
  const supabase = await createClient();
  // Filtro por etiqueta: junção interna só quando pedido.
  const columns = filters.tag ? `${TASK_COLUMNS}, tag_filter:task_tags!inner(tag_id)` : TASK_COLUMNS;
  let q = supabase.from("tasks").select(columns).is("deleted_at", null);

  const status = filters.status ?? "abertas";
  if (status === "abertas") q = q.in("status", ["a_fazer", "em_andamento"]);
  if (status === "concluidas") q = q.eq("status", "concluida");
  if (filters.responsavel === "eu") {
    const { data } = await supabase.auth.getClaims();
    q = q.eq("owner_id", data?.claims?.sub ?? "");
  } else if (filters.responsavel) q = q.eq("owner_id", filters.responsavel);
  if (filters.prioridade) q = q.eq("priority", filters.prioridade);
  if (filters.lead) q = q.eq("lead_id", filters.lead);
  if (filters.tag) q = q.eq("tag_filter.tag_id", filters.tag);
  if (filters.q) q = q.ilike("title", `%${filters.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);

  const now = new Date();
  const endToday = new Date(`${todayLocal()}T23:59:59.999-03:00`);
  if (filters.periodo === "atrasadas") q = q.lt("due_at", now.toISOString());
  if (filters.periodo === "hoje") q = q.lte("due_at", endToday.toISOString()).gte("due_at", new Date(`${todayLocal()}T00:00:00-03:00`).toISOString());
  if (filters.periodo === "semana") q = q.lte("due_at", new Date(endToday.getTime() + 6 * 86_400_000).toISOString());
  if (filters.periodo === "sem_prazo") q = q.is("due_at", null);

  const { data, error } = await q.order("due_at", { ascending: true, nullsFirst: false }).order("position").limit(limit);
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map(toTask);
}

/** "Meu dia": atrasadas + de hoje (abertas) e concluídas hoje, do usuário atual. */
export async function getMyDay(userId: string) {
  const supabase = await createClient();
  const start = new Date(`${todayLocal()}T00:00:00-03:00`).toISOString();
  const end = new Date(`${todayLocal()}T23:59:59.999-03:00`).toISOString();

  const [open, doneToday, leadsToday, events] = await Promise.all([
    supabase
      .from("tasks")
      .select(TASK_COLUMNS)
      .is("deleted_at", null)
      .eq("owner_id", userId)
      .in("status", ["a_fazer", "em_andamento"])
      .lte("due_at", end)
      .order("due_at")
      .limit(200),
    supabase.from("tasks").select(TASK_COLUMNS).is("deleted_at", null).eq("owner_id", userId).eq("status", "concluida").gte("completed_at", start).order("completed_at", { ascending: false }).limit(50),
    supabase
      .from("leads")
      .select("id, name, next_contact_at, whatsapp_e164, city")
      .is("deleted_at", null)
      .eq("owner_id", userId)
      .lte("next_contact_at", end)
      .order("next_contact_at")
      .limit(50),
    supabase
      .from("calendar_events")
      .select("id, title, starts_at, ends_at, all_day, kind, location, meet_url, lead_id")
      .is("deleted_at", null)
      .eq("owner_id", userId)
      .lt("starts_at", end)
      .gt("ends_at", start)
      .order("starts_at")
      .limit(50),
  ]);
  for (const result of [open, doneToday, leadsToday, events]) if (result.error) throw result.error;

  return {
    open: ((open.data ?? []) as Row[]).map(toTask),
    doneToday: ((doneToday.data ?? []) as Row[]).map(toTask),
    leads: (leadsToday.data ?? []) as { id: string; name: string; next_contact_at: string; whatsapp_e164: string | null; city: string | null }[],
    events: (events.data ?? []) as { id: string; title: string; starts_at: string; ends_at: string; all_day: boolean; kind: string; location: string | null; meet_url: string | null; lead_id: string | null }[],
  };
}

export async function getTask(id: string) {
  const supabase = await createClient();
  const [task, comments] = await Promise.all([
    supabase.from("tasks").select(TASK_COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("task_comments").select("id, author_id, body, created_at").eq("task_id", id).order("created_at"),
  ]);
  if (task.error) throw task.error;
  if (comments.error) throw comments.error;
  if (!task.data) return null;
  return { task: toTask(task.data as Row), comments: (comments.data ?? []) as TaskComment[] };
}

// --- Agenda ------------------------------------------------------------------

export type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  kind: "reuniao" | "compromisso" | "bloqueio";
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  meet_url: string | null;
  owner_id: string | null;
  lead_id: string | null;
  reminder_minutes: number[];
  lead: { id: string; name: string } | null;
  attendees: string[];
};

export async function listAgenda(range: { start: Date; end: Date }, filters: { responsavel?: string; tipo?: string }) {
  const supabase = await createClient();
  const startIso = range.start.toISOString();
  const endIso = range.end.toISOString();

  let ev = supabase
    .from("calendar_events")
    .select("id, title, description, kind, starts_at, ends_at, all_day, location, meet_url, owner_id, lead_id, reminder_minutes, lead:leads(id, name), event_attendees(user_id)")
    .is("deleted_at", null)
    .lt("starts_at", endIso)
    .gt("ends_at", startIso)
    .order("starts_at")
    .limit(1000);
  let tk = supabase
    .from("tasks")
    .select("id, title, due_at, duration_minutes, owner_id, status, priority, lead_id, channel")
    .is("deleted_at", null)
    .eq("has_time", true)
    .neq("status", "cancelada")
    .gte("due_at", startIso)
    .lt("due_at", endIso)
    .limit(1000);

  if (filters.responsavel) {
    ev = ev.eq("owner_id", filters.responsavel);
    tk = tk.eq("owner_id", filters.responsavel);
  }

  const [events, tasks] = await Promise.all([filters.tipo === "tarefa" ? Promise.resolve({ data: [], error: null }) : ev, filters.tipo === "evento" ? Promise.resolve({ data: [], error: null }) : tk]);
  if (events.error) throw events.error;
  if (tasks.error) throw tasks.error;

  const evs = ((events.data ?? []) as Row[]).map((e) => ({
    ...(e as unknown as CalendarEvent),
    lead: (Array.isArray(e.lead) ? e.lead[0] : e.lead) as CalendarEvent["lead"],
    attendees: ((e.event_attendees as { user_id: string }[] | null) ?? []).map((a) => a.user_id),
  }));

  const items: (CalItem & { meta: Record<string, unknown> })[] = [
    ...evs.map((e) => ({ id: e.id, kind: "evento" as const, title: e.title, start: e.starts_at, end: e.ends_at, allDay: e.all_day, ownerId: e.owner_id, meta: { eventKind: e.kind, location: e.location, leadName: e.lead?.name } })),
    ...((tasks.data ?? []) as { id: string; title: string; due_at: string; duration_minutes: number | null; owner_id: string | null; status: string; lead_id: string | null }[]).map((t) => ({
      id: t.id,
      kind: "tarefa" as const,
      title: t.title,
      start: t.due_at,
      end: new Date(new Date(t.due_at).getTime() + (t.duration_minutes ?? 30) * 60_000).toISOString(),
      allDay: false,
      ownerId: t.owner_id,
      meta: { status: t.status, leadId: t.lead_id },
    })),
  ];

  return { items, events: evs };
}

export async function getEvent(id: string): Promise<CalendarEvent | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendar_events")
    .select("id, title, description, kind, starts_at, ends_at, all_day, location, meet_url, owner_id, lead_id, reminder_minutes, lead:leads(id, name), event_attendees(user_id)")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const e = data as Row;
  return {
    ...(e as unknown as CalendarEvent),
    lead: (Array.isArray(e.lead) ? e.lead[0] : e.lead) as CalendarEvent["lead"],
    attendees: ((e.event_attendees as { user_id: string }[] | null) ?? []).map((a) => a.user_id),
  };
}

// --- Cadências -----------------------------------------------------------------

export type CadenceStep = { id: string; position: number; day_offset: number; time_of_day: string; channel: string; title: string; instruction: string; message: string };
export type CadenceTemplate = { id: string; name: string; description: string; is_active: boolean; steps: CadenceStep[]; enrollments: number };

export async function listCadences(): Promise<CadenceTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cadence_templates")
    .select("id, name, description, is_active, cadence_steps(id, position, day_offset, time_of_day, channel, title, instruction, message), cadence_enrollments(count)")
    .order("name");
  if (error) throw error;
  return ((data ?? []) as Row[]).map((t) => ({
    ...(t as unknown as CadenceTemplate),
    steps: ((t.cadence_steps as CadenceStep[]) ?? []).sort((a, b) => a.position - b.position),
    enrollments: (t.cadence_enrollments as { count: number }[] | null)?.[0]?.count ?? 0,
  }));
}

export async function getLeadWork(leadId: string) {
  const supabase = await createClient();
  const [tasks, events, enrollments] = await Promise.all([
    supabase.from("tasks").select(TASK_COLUMNS).eq("lead_id", leadId).is("deleted_at", null).order("due_at", { nullsFirst: false }).limit(100),
    supabase.from("calendar_events").select("id, title, starts_at, ends_at, kind, all_day").eq("lead_id", leadId).is("deleted_at", null).order("starts_at", { ascending: false }).limit(50),
    supabase.from("cadence_enrollments").select("id, status, started_at, template:cadence_templates(id, name)").eq("lead_id", leadId).order("started_at", { ascending: false }),
  ]);
  for (const result of [tasks, events, enrollments]) if (result.error) throw result.error;
  return {
    tasks: ((tasks.data ?? []) as Row[]).map(toTask),
    events: (events.data ?? []) as { id: string; title: string; starts_at: string; ends_at: string; kind: string; all_day: boolean }[],
    enrollments: ((enrollments.data ?? []) as Row[]).map((e) => ({
      id: e.id as string,
      status: e.status as string,
      started_at: e.started_at as string,
      template: (Array.isArray(e.template) ? e.template[0] : e.template) as { id: string; name: string } | null,
    })),
  };
}
