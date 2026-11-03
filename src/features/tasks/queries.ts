import "server-only";
import { createClient } from "@/lib/supabase/server";
import { todayLocal } from "@/domain/shared/dates";
import type { CalItem } from "@/domain/calendar";
import { filterAgenda, sortAgenda, EVENT_STATUS_LABEL, type AgendaEntry, type AgendaFilter } from "@/domain/calendar/agenda";
import type { Task, TaskBoard, TaskColumn, TaskComment } from "./types";
import { STATUS_LABEL, type TaskStatus } from "./types";

const TASK_COLUMNS = `
  id, title, description, owner_id, priority, status, start_date, due_at, has_time, duration_minutes, category,
  position, lead_id, deal_id, channel, suggested_message, outcome, completed_at, created_by, created_at, cadence_enrollment_id, column_id,
  client_id,
  lead:leads(id, name, whatsapp_e164),
  client:clients(id, legal_name),
  list:task_columns(id, name, board:task_boards(id, name)),
  checklist:task_checklist_items(id, title, position, done_at),
  task_tags(tag:tags(id, name, color)),
  task_participants(user_id)
`;

type Row = Record<string, unknown>;

function toTask(r: Row): Task {
  const lead = Array.isArray(r.lead) ? r.lead[0] : r.lead;
  const client = Array.isArray(r.client) ? r.client[0] : r.client;
  const rawList = (Array.isArray(r.list) ? r.list[0] : r.list) as { id: string; name: string; board: unknown } | null;
  const list = rawList ? { id: rawList.id, name: rawList.name, board: (Array.isArray(rawList.board) ? rawList.board[0] : rawList.board) as { id: string; name: string } | null } : null;
  const tags = ((r.task_tags as { tag: Task["tags"][number] | null }[] | null) ?? []).flatMap((t) => (t.tag ? [t.tag] : []));
  return {
    ...(r as unknown as Task),
    lead: (lead as Task["lead"]) ?? null,
    client: (client as Task["client"]) ?? null,
    list,
    checklist: ((r.checklist as Task["checklist"]) ?? []).sort((a, b) => a.position - b.position),
    tags,
    participant_ids: ((r.task_participants as { user_id: string }[] | null) ?? []).map((p) => p.user_id),
  };
}

/** Quadros ativos, com o principal primeiro. */
export async function listTaskBoards(): Promise<TaskBoard[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("task_boards").select("id, name, description, client_id, is_default, position").is("archived_at", null).order("is_default", { ascending: false }).order("position").order("name");
  if (error) throw error;
  return (data ?? []) as TaskBoard[];
}

/** Listas ativas (de um quadro ou de todos), na ordem definida pela organização. */
export async function listTaskColumns(boardId?: string): Promise<TaskColumn[]> {
  const supabase = await createClient();
  let q = supabase.from("task_columns").select("id, board_id, name, color, kind, position, archived_at").is("archived_at", null);
  if (boardId) q = q.eq("board_id", boardId);
  const { data, error } = await q.order("position");
  if (error) throw error;
  return (data ?? []) as TaskColumn[];
}

/** Clientes que a pessoa pode ver, para escolher em tarefas, eventos e quadros. */
export async function listClientOptions() {
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("id, legal_name").is("deleted_at", null).order("legal_name").limit(500);
  return (data ?? []) as { id: string; legal_name: string }[];
}

export type TaskFilters = {
  tag?: string;
  responsavel?: string;
  status?: "abertas" | "concluidas" | "todas";
  prioridade?: string;
  q?: string;
  lead?: string;
  periodo?: "atrasadas" | "hoje" | "semana" | "sem_prazo";
  /** Listas do quadro escolhido. */
  columnIds?: string[];
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
  if (filters.columnIds) q = q.in("column_id", filters.columnIds);
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
  client_id: string | null;
  status: "agendado" | "confirmado" | "concluido" | "cancelado";
  reminder_minutes: number[];
  lead: { id: string; name: string } | null;
  client: { id: string; legal_name: string } | null;
  attendees: string[];
  send_updates: boolean;
  guests: { email: string; name: string; optional: boolean; response_status: string }[];
};

const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * Tudo o que tem data, lido direto das tabelas de origem: não existe cópia para
 * ficar diferente. A RLS decide o que cada pessoa vê; quem não pode ver tarefas
 * simplesmente não recebe tarefas.
 */
export async function listAgendaEntries(range: { start: Date; end: Date }, filter?: AgendaFilter): Promise<AgendaEntry[]> {
  const supabase = await createClient();
  const startIso = range.start.toISOString();
  const endIso = range.end.toISOString();
  const [events, tasks] = await Promise.all([
    supabase
      .from("calendar_events")
      .select("id, title, description, kind, status, starts_at, ends_at, all_day, location, meet_url, owner_id, lead_id, client_id, lead:leads(id, name), client:clients(id, legal_name)")
      .is("deleted_at", null)
      .lt("starts_at", endIso)
      .gt("ends_at", startIso)
      .order("starts_at")
      .limit(1000),
    supabase
      .from("tasks")
      .select("id, title, description, due_at, has_time, duration_minutes, owner_id, status, lead_id, client_id, lead:leads(id, name), client:clients(id, legal_name), list:task_columns(id, name, board:task_boards(id, name))")
      .is("deleted_at", null)
      .not("due_at", "is", null)
      .gte("due_at", startIso)
      .lt("due_at", endIso)
      .limit(1000),
  ]);
  if (events.error) throw events.error;
  if (tasks.error) throw tasks.error;

  const fromEvents: AgendaEntry[] = ((events.data ?? []) as Row[]).map((e) => {
    const lead = one(e.lead as { id: string; name: string } | null);
    const client = one(e.client as { id: string; legal_name: string } | null);
    return {
      id: e.id as string,
      source: "evento",
      type: e.kind as AgendaEntry["type"],
      title: e.title as string,
      start: e.starts_at as string,
      end: e.ends_at as string,
      allDay: e.all_day as boolean,
      ownerId: e.owner_id as string | null,
      status: e.status as string,
      statusLabel: EVENT_STATUS_LABEL[e.status as string] ?? (e.status as string),
      description: e.description as string | null,
      clientId: client?.id ?? null,
      clientName: client?.legal_name ?? null,
      leadId: lead?.id ?? null,
      leadName: lead?.name ?? null,
      location: e.location as string | null,
      meetUrl: e.meet_url as string | null,
      taskId: null,
      boardId: null,
      boardName: null,
      listName: null,
    };
  });
  const fromTasks: AgendaEntry[] = ((tasks.data ?? []) as Row[]).map((t) => {
    const lead = one(t.lead as { id: string; name: string } | null);
    const client = one(t.client as { id: string; legal_name: string } | null);
    const list = one(t.list as { id: string; name: string; board: unknown } | null);
    const board = list ? one(list.board as { id: string; name: string } | null) : null;
    const due = t.due_at as string;
    const hasTime = t.has_time as boolean;
    return {
      id: t.id as string,
      source: "tarefa",
      type: hasTime ? "tarefa" : "prazo",
      title: t.title as string,
      start: due,
      end: hasTime ? new Date(new Date(due).getTime() + ((t.duration_minutes as number | null) ?? 30) * 60_000).toISOString() : due,
      allDay: !hasTime,
      ownerId: t.owner_id as string | null,
      status: t.status as string,
      statusLabel: STATUS_LABEL[t.status as TaskStatus] ?? (t.status as string),
      description: t.description as string | null,
      clientId: client?.id ?? null,
      clientName: client?.legal_name ?? null,
      leadId: lead?.id ?? null,
      leadName: lead?.name ?? null,
      location: null,
      meetUrl: null,
      taskId: t.id as string,
      boardId: board?.id ?? null,
      boardName: board?.name ?? null,
      listName: list?.name ?? null,
    };
  });
  const all = [...fromEvents, ...fromTasks];
  return sortAgenda(filter ? filterAgenda(all, filter) : all);
}

/** Agenda em grade: entradas no formato do calendário. */
export async function listAgenda(range: { start: Date; end: Date }, filter: AgendaFilter) {
  const entries = await listAgendaEntries(range, filter);
  const items: (CalItem & { meta: { entry: AgendaEntry; status: string } })[] = entries.map((e) => ({
    id: e.id,
    kind: e.source === "evento" ? ("evento" as const) : ("tarefa" as const),
    title: e.title,
    start: e.start,
    end: e.allDay ? new Date(new Date(e.start).getTime() + 60_000).toISOString() : e.end,
    allDay: e.allDay,
    ownerId: e.ownerId,
    meta: { entry: e, status: e.status },
  }));
  return { items };
}

export async function getEvent(id: string): Promise<CalendarEvent | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendar_events")
    .select("id, title, description, kind, status, starts_at, ends_at, all_day, location, meet_url, owner_id, lead_id, client_id, reminder_minutes, send_updates, lead:leads(id, name), client:clients(id, legal_name), event_attendees(user_id), event_guests(email, name, optional, response_status)")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const e = data as Row;
  return {
    ...(e as unknown as CalendarEvent),
    lead: (Array.isArray(e.lead) ? e.lead[0] : e.lead) as CalendarEvent["lead"],
    client: (Array.isArray(e.client) ? e.client[0] : e.client) as CalendarEvent["client"],
    attendees: ((e.event_attendees as { user_id: string }[] | null) ?? []).map((a) => a.user_id),
    guests: (e.event_guests as CalendarEvent["guests"] | null) ?? [],
  };
}

// --- Cadências -----------------------------------------------------------------

export type CadenceStep = {
  id: string;
  position: number;
  day_offset: number;
  time_of_day: string;
  channel: string;
  title: string;
  instruction: string;
  message: string;
  auto_send: boolean;
  whatsapp_template: string | null;
  template_language: string;
  add_tag_id: string | null;
  move_to_stage_id: string | null;
};
export type CadenceTemplate = {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
  require_consent: boolean;
  send_window: { start: string; end: string; days: number[] };
  steps: CadenceStep[];
  enrollments: number;
};

export async function listCadences(): Promise<CadenceTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cadence_templates")
    .select("id, name, description, is_active, require_consent, send_window, cadence_steps(id, position, day_offset, time_of_day, channel, title, instruction, message, auto_send, whatsapp_template, template_language, add_tag_id, move_to_stage_id), cadence_enrollments(count)")
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
