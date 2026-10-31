import { TZDate } from "@date-fns/tz";
import { addDays, addMonths, endOfMonth, endOfWeek, format, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { APP_TIMEZONE } from "@/domain/shared/dates";

export type CalendarView = "dia" | "semana" | "mes";

export type CalItem = {
  id: string;
  kind: "evento" | "tarefa";
  title: string;
  start: string; // ISO
  end: string; // ISO
  allDay: boolean;
  ownerId: string | null;
};

/** "YYYY-MM-DD" → meia-noite em São Paulo. */
export function zonedDay(day: string): TZDate {
  const [y, m, d] = day.split("-").map(Number);
  return new TZDate(y, m - 1, d, 0, 0, 0, APP_TIMEZONE);
}

export function dayKey(value: Date | string): string {
  return format(new TZDate(new Date(value).getTime(), APP_TIMEZONE), "yyyy-MM-dd");
}

/** Intervalo [início, fim) exibido para uma visão, com semanas começando no domingo. */
export function viewRange(view: CalendarView, day: string): { start: TZDate; end: TZDate; days: string[] } {
  const base = zonedDay(day);
  let start: TZDate;
  let end: TZDate;
  if (view === "dia") {
    start = startOfDay(base);
    end = addDays(start, 1);
  } else if (view === "semana") {
    start = startOfWeek(base, { weekStartsOn: 0 });
    end = addDays(start, 7);
  } else {
    start = startOfWeek(startOfMonth(base), { weekStartsOn: 0 });
    end = addDays(endOfWeek(endOfMonth(base), { weekStartsOn: 0 }), 1);
    end = startOfDay(end);
  }
  const days: string[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) days.push(format(d, "yyyy-MM-dd"));
  return { start, end, days };
}

export function shiftDay(view: CalendarView, day: string, dir: -1 | 1): string {
  const base = zonedDay(day);
  const next = view === "dia" ? addDays(base, dir) : view === "semana" ? addDays(base, 7 * dir) : addMonths(base, dir);
  return format(next, "yyyy-MM-dd");
}

function overlaps(a: CalItem, b: CalItem) {
  return new Date(a.start) < new Date(b.end) && new Date(b.start) < new Date(a.end);
}

/**
 * Conflitos: itens com horário do mesmo responsável que se sobrepõem.
 * Retorna o conjunto de ids em conflito.
 */
export function findConflicts(items: CalItem[]): Set<string> {
  const timed = items.filter((i) => !i.allDay).sort((a, b) => a.start.localeCompare(b.start));
  const out = new Set<string>();
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      if (new Date(timed[j].start) >= new Date(timed[i].end)) break;
      if (timed[i].ownerId === timed[j].ownerId && overlaps(timed[i], timed[j])) {
        out.add(timed[i].id);
        out.add(timed[j].id);
      }
    }
  }
  return out;
}

/** Distribui itens sobrepostos de um dia em colunas (para a grade de horários). */
export function layoutDay(items: CalItem[]): Map<string, { col: number; cols: number }> {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
  const result = new Map<string, { col: number; cols: number }>();
  let cluster: CalItem[] = [];
  let clusterEnd = 0;
  const columnsEnd: number[] = [];

  const flush = () => {
    const cols = Math.max(1, columnsEnd.length);
    for (const it of cluster) result.set(it.id, { col: result.get(it.id)!.col, cols });
    cluster = [];
    columnsEnd.length = 0;
  };

  for (const it of sorted) {
    const s = new Date(it.start).getTime();
    const e = new Date(it.end).getTime();
    if (cluster.length && s >= clusterEnd) flush();
    let col = columnsEnd.findIndex((end) => end <= s);
    if (col === -1) {
      col = columnsEnd.length;
      columnsEnd.push(e);
    } else columnsEnd[col] = e;
    result.set(it.id, { col, cols: 1 });
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, e);
  }
  if (cluster.length) flush();
  return result;
}

/** Minutos desde a meia-noite (São Paulo) de um instante. */
export function minutesOfDay(iso: string): number {
  const d = new TZDate(new Date(iso).getTime(), APP_TIMEZONE);
  return d.getHours() * 60 + d.getMinutes();
}

/** Monta um ISO a partir de data civil + "HH:mm" em São Paulo. */
export function zonedIso(day: string, time: string): string {
  const [h, m] = time.split(":").map(Number);
  const [y, mo, d] = day.split("-").map(Number);
  // Sempre em UTC ("Z"): o TZDate serializa com offset e quebraria comparações de texto.
  return new Date(new TZDate(y, mo - 1, d, h, m, 0, APP_TIMEZONE).getTime()).toISOString();
}

// --- Disponibilidade -------------------------------------------------------------

export type Interval = { start: string; end: string };
/** Expediente: horários "HH:mm" e dias da semana (0 = domingo). */
export type WorkHours = { start: string; end: string; days: number[] };
export const DEFAULT_WORK_HOURS: WorkHours = { start: "08:00", end: "18:00", days: [1, 2, 3, 4, 5] };

/** Une intervalos sobrepostos ou encostados. */
export function mergeIntervals(items: Interval[]): Interval[] {
  const sorted = items
    .map((i) => ({ s: new Date(i.start).getTime(), e: new Date(i.end).getTime() }))
    .filter((i) => i.e > i.s)
    .sort((a, b) => a.s - b.s);
  const out: { s: number; e: number }[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.s <= last.e) last.e = Math.max(last.e, i.e);
    else out.push({ ...i });
  }
  return out.map((i) => ({ start: new Date(i.s).toISOString(), end: new Date(i.e).toISOString() }));
}

/**
 * Faixas livres de um dia dentro do expediente (fuso de São Paulo), com pelo
 * menos `minMinutes`. Horários que já passaram não contam.
 */
export function freeSlots(day: string, busy: Interval[], work: WorkHours = DEFAULT_WORK_HOURS, minMinutes = 30, now = new Date()): Interval[] {
  if (!work.days.includes(zonedDay(day).getDay())) return [];
  const startMs = Math.max(new Date(zonedIso(day, work.start)).getTime(), Math.ceil(now.getTime() / 900_000) * 900_000);
  const endMs = new Date(zonedIso(day, work.end)).getTime();
  if (endMs <= startMs) return [];
  const out: Interval[] = [];
  let cursor = startMs;
  for (const b of mergeIntervals(busy)) {
    const bs = new Date(b.start).getTime();
    const be = new Date(b.end).getTime();
    if (be <= cursor) continue;
    if (bs >= endMs) break;
    if (bs > cursor) out.push({ start: new Date(cursor).toISOString(), end: new Date(Math.min(bs, endMs)).toISOString() });
    cursor = Math.max(cursor, be);
  }
  if (cursor < endMs) out.push({ start: new Date(cursor).toISOString(), end: new Date(endMs).toISOString() });
  return out.filter((i) => new Date(i.end).getTime() - new Date(i.start).getTime() >= minMinutes * 60_000);
}

/** O intervalo pedido colide com algum horário ocupado? */
export function overlapsBusy(slot: Interval, busy: Interval[]): boolean {
  const s = new Date(slot.start).getTime();
  const e = new Date(slot.end).getTime();
  return busy.some((b) => new Date(b.start).getTime() < e && s < new Date(b.end).getTime());
}
