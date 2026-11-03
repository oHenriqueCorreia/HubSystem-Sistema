import { dayKey } from "./index";

export type AgendaType = "reuniao" | "compromisso" | "bloqueio" | "tarefa" | "prazo" | "publicacao";
export type AgendaSource = "evento" | "tarefa" | "publicacao";

export type AgendaEntry = {
  id: string;
  source: AgendaSource;
  type: AgendaType;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  ownerId: string | null;
  status: string;
  statusLabel: string;
  description: string | null;
  clientId: string | null;
  clientName: string | null;
  leadId: string | null;
  leadName: string | null;
  location: string | null;
  meetUrl: string | null;
  taskId: string | null;
  boardId: string | null;
  boardName: string | null;
  listName: string | null;
};

export const AGENDA_TYPE_LABEL: Record<AgendaType, string> = {
  reuniao: "Reunião",
  compromisso: "Compromisso",
  bloqueio: "Bloqueio",
  tarefa: "Tarefa",
  prazo: "Prazo",
  publicacao: "Publicação",
};

export const EVENT_STATUS_LABEL: Record<string, string> = { agendado: "Agendado", confirmado: "Confirmado", concluido: "Concluído", cancelado: "Cancelado" };

/** Situação em grupos comuns, para filtrar eventos, tarefas e publicações juntos. */
export type AgendaStatusGroup = "aberto" | "concluido" | "cancelado";
export function statusGroup(entry: Pick<AgendaEntry, "status">): AgendaStatusGroup {
  if (["cancelado", "cancelada"].includes(entry.status)) return "cancelado";
  if (["concluido", "concluida", "publicado"].includes(entry.status)) return "concluido";
  return "aberto";
}

export type AgendaFilter = { q?: string; type?: AgendaType | null; ownerIds?: string[]; clientId?: string | null; status?: AgendaStatusGroup | null };

const normalize = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function filterAgenda(entries: AgendaEntry[], f: AgendaFilter) {
  const q = f.q?.trim() ? normalize(f.q.trim()) : null;
  return entries.filter((e) => {
    if (f.type && e.type !== f.type) return false;
    if (f.ownerIds?.length && !(e.ownerId && f.ownerIds.includes(e.ownerId))) return false;
    if (f.clientId && e.clientId !== f.clientId) return false;
    if (f.status ? statusGroup(e) !== f.status : statusGroup(e) === "cancelado") return false;
    if (q && !normalize([e.title, e.clientName, e.leadName, e.description, e.boardName, e.listName].filter(Boolean).join(" ")).includes(q)) return false;
    return true;
  });
}

/** Ordem de leitura: dia inteiro primeiro, depois por horário e, no empate, por título. */
export function sortAgenda(entries: AgendaEntry[]) {
  return [...entries].sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title, "pt-BR"));
}

/** Agrupa por dia. Item de vários dias aparece em cada dia que cobre. */
export function groupByDay(entries: AgendaEntry[]) {
  const out = new Map<string, AgendaEntry[]>();
  for (const e of entries) {
    const first = dayKey(e.start);
    const last = dayKey(new Date(Math.max(new Date(e.end).getTime() - 1, new Date(e.start).getTime())));
    let current = first;
    for (let guard = 0; current <= last && guard < 40; guard++) {
      out.set(current, [...(out.get(current) ?? []), e]);
      current = addDays(current, 1);
    }
  }
  for (const [k, v] of out) out.set(k, sortAgenda(v));
  return out;
}

export function addDays(day: string, days: number) {
  return new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + days)).toISOString().slice(0, 10);
}

export function listDays(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Domingo a sábado da semana do dia. */
export function weekRange(day: string) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const from = addDays(day, -weekday);
  return { from, to: addDays(from, 6) };
}

/** Grade do mês: começa no domingo antes do dia 1 e termina no sábado depois do último dia. */
export function monthRange(day: string) {
  const first = `${day.slice(0, 7)}-01`;
  const next = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const last = addDays(next, -1);
  return { from: weekRange(first).from, to: weekRange(last).to };
}

export const MAX_RANGE_DAYS = 92;

export function validRange(from: string, to: string) {
  return from <= to && listDays(from, to).length <= MAX_RANGE_DAYS;
}
