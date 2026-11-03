"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronLeft, ChevronRight, LoaderCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "cn";
import { dayKey, findConflicts, layoutDay, minutesOfDay, shiftDay, type CalendarView, type CalItem } from "@/domain/calendar";
import { todayLocal } from "@/domain/shared/dates";
import { EventDialog, type EventDraft } from "./event-dialog";
import { AGENDA_TYPE_LABEL, type AgendaEntry } from "@/domain/calendar/agenda";
import { DEFAULT_AGENDA_PREFS, priorityColor, visibleDays, type AgendaPrefs } from "@/domain/calendar/agenda-prefs";
import { MobileFilters } from "@/components/app/mobile-filters";
import { AgendaCustomize, AgendaLegend, entryLook, PriorityTag, useAgendaPrefs } from "./agenda-customize";
import { AGENDA_STYLE, AgendaItemSheet } from "./agenda-item-sheet";
import type { CalendarEvent } from "../queries";

type Item = CalItem & { meta: { entry: AgendaEntry; status: string } };
type Owner = { id: string; full_name: string; email: string };

const DEFAULT_START_HOUR = 6;
const DEFAULT_END_HOUR = 22;
const HOUR_PX = 56;
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const ALL = "__todos__";

function labelFor(view: CalendarView, day: string, days: string[]) {
  const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("pt-BR", { ...opts, timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  if (view === "dia") return fmt(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (view === "semana") return `${fmt(days[0], { day: "numeric", month: "short" })} – ${fmt(days[6], { day: "numeric", month: "short", year: "numeric" })}`;
  return fmt(day, { month: "long", year: "numeric" });
}

export function CalendarViewClient({
  view,
  day,
  days,
  items: allItems,
  owners,
  meId,
  canManage,
  canAssign,
  canSeeOthers,
  canEditTasks,
  canPublish,
  clients,
  initialPrefs = DEFAULT_AGENDA_PREFS,
}: {
  view: CalendarView;
  day: string;
  days: string[];
  items: Item[];
  owners: Owner[];
  meId: string;
  canManage: boolean;
  canAssign: boolean;
  canSeeOthers: boolean;
  canEditTasks: boolean;
  canPublish: boolean;
  clients: { id: string; legal_name: string }[];
  initialPrefs?: AgendaPrefs;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<{ event?: CalendarEvent | null; draft?: EventDraft | null } | null>(null);
  const [selected, setSelected] = useState<AgendaEntry | null>(null);
  const today = todayLocal();
  const [prefs, updatePrefs] = useAgendaPrefs(initialPrefs);
  const items = useMemo(() => allItems.filter((i) => !prefs.hiddenTypes.includes(i.meta.entry.type)), [allItems, prefs.hiddenTypes]);
  const shownDays = visibleDays(days, prefs);
  const conflicts = useMemo(() => findConflicts(items), [items]);
  const ownerName = useMemo(() => new Map(owners.map((o) => [o.id, o.full_name || o.email])), [owners]);

  function nav(next: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v && v !== ALL) q.set(k, v);
      else q.delete(k);
    }
    startTransition(() => router.replace(`${pathname}?${q.toString()}`, { scroll: false }));
  }

  function openItem(it: Item) {
    setSelected(it.meta.entry);
  }

  function quickCreate(date: string, time?: string) {
    if (!canManage) return;
    setDialog({ draft: { date, time } });
  }

  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of items) {
      // Itens de vários dias aparecem em cada dia coberto.
      let d = dayKey(it.start);
      const last = dayKey(new Date(new Date(it.end).getTime() - 1));
      for (let guard = 0; d <= last && guard < 40; guard++) {
        m.set(d, [...(m.get(d) ?? []), it]);
        d = shiftDay("dia", d, 1);
      }
    }
    return m;
  }, [items]);

  const conflictCount = conflicts.size;

  // Sete colunas não cabem no celular: sem visão escolhida, abre no dia.
  useEffect(() => {
    if (!params.get("visao") && window.matchMedia("(max-width: 767px)").matches) nav({ visao: "dia" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na abertura da tela
  }, []);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => nav({ data: today })}>
          Hoje
        </Button>
        <div className="flex">
          <Button variant="ghost" size="icon-sm" aria-label="Anterior" onClick={() => nav({ data: shiftDay(view, day, -1) })}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Próximo" onClick={() => nav({ data: shiftDay(view, day, 1) })}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
        <h2 className="min-w-0 text-base font-semibold first-letter:uppercase" aria-live="polite">
          {labelFor(view, day, days)}
        </h2>
        {pending && <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-label="Carregando" />}
        <div className="flex w-full flex-wrap items-center gap-2 md:ml-auto md:w-auto">
          <nav aria-label="Visão" className="inline-flex rounded-lg border bg-surface p-0.5">
            {(["dia", "semana", "mes"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => nav({ visao: v })}
                aria-pressed={view === v}
                className={cn("rounded-md px-3 py-1 text-sm font-medium", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {v === "dia" ? "Dia" : v === "semana" ? "Semana" : "Mês"}
              </button>
            ))}
          </nav>
          <AgendaCustomize prefs={prefs} onChange={updatePrefs} />
          {canManage && (
            <Button size="sm" className="max-md:flex-auto" onClick={() => quickCreate(view === "mes" ? today : day)}>
              <Plus aria-hidden="true" /> Novo evento
            </Button>
          )}
          <MobileFilters active={["responsavel", "tipo", "cliente", "situacao"].filter((k) => params.get(k)).length}>
          {canSeeOthers && (
            <Select value={params.get("responsavel") ?? ALL} onValueChange={(v) => nav({ responsavel: v })}>
              <SelectTrigger className="w-44" aria-label="Agenda de">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as agendas</SelectItem>
                {owners.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.id === meId ? "Minha agenda" : o.full_name || o.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={params.get("tipo") ?? ALL} onValueChange={(v) => nav({ tipo: v })}>
            <SelectTrigger className="w-40" aria-label="Tipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos os tipos</SelectItem>
              {Object.entries(AGENDA_TYPE_LABEL).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {clients.length > 0 && (
            <Select value={params.get("cliente") ?? ALL} onValueChange={(v) => nav({ cliente: v })}>
              <SelectTrigger className="w-44" aria-label="Cliente">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os clientes</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.legal_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={params.get("situacao") ?? ALL} onValueChange={(v) => nav({ situacao: v })}>
            <SelectTrigger className="w-44" aria-label="Situação">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Abertos e concluídos</SelectItem>
              <SelectItem value="aberto">Só em aberto</SelectItem>
              <SelectItem value="concluido">Só concluídos</SelectItem>
              <SelectItem value="cancelado">Só cancelados</SelectItem>
            </SelectContent>
          </Select>
          </MobileFilters>
        </div>
      </div>

      {conflictCount > 0 && (
        <p className="flex items-center gap-2 text-sm text-warning" role="status">
          <AlertTriangle className="size-4" aria-hidden="true" /> {conflictCount} compromisso(s) com horário sobreposto neste período.
        </p>
      )}

      {view === "mes" ? (
        <div className="overflow-hidden rounded-xl border bg-surface">
          <div className="grid border-b text-center text-xs font-medium text-muted-foreground md:text-left" style={{ gridTemplateColumns: `repeat(${prefs.weekends ? 7 : 5}, minmax(0, 1fr))` }} aria-hidden="true">
            {WEEKDAYS.filter((_, i) => prefs.weekends || (i !== 0 && i !== 6)).map((w) => (
              <div key={w} className="px-2 py-1.5">
                {w}
              </div>
            ))}
          </div>
          <div className="grid" style={{ gridTemplateColumns: `repeat(${prefs.weekends ? 7 : 5}, minmax(0, 1fr))` }} role="grid" aria-label="Mês">
            {shownDays.map((d) => {
              const list = (byDay.get(d) ?? []).sort((a, b) => a.start.localeCompare(b.start));
              const outside = d.slice(0, 7) !== day.slice(0, 7);
              return (
                <div key={d} role="gridcell" className={cn("relative min-h-16 min-w-0 border-r border-b p-1 last:border-r-0 md:min-h-28", outside && "bg-muted/40")}>
                  <button
                    type="button"
                    onClick={() => nav({ visao: "dia", data: d })}
                    className={cn(
                      "mb-1 grid size-6 place-items-center rounded-full text-xs tabular",
                      d === today ? "bg-primary font-semibold text-primary-foreground" : outside ? "text-muted-foreground" : "",
                    )}
                    aria-label={`Abrir o dia ${d.split("-").reverse().join("/")}`}
                  >
                    {Number(d.slice(8))}
                  </button>
                  {/* Celular: pontos e o total; tocar abre o dia inteiro. */}
                  <button type="button" onClick={() => nav({ visao: "dia", data: d })} className="absolute inset-0 grid content-end justify-items-center gap-0.5 pb-1.5 md:hidden" aria-label={`Abrir o dia ${d.split("-").reverse().join("/")}: ${list.length} ${list.length === 1 ? "item" : "itens"}`}>
                    {list.length > 0 && (
                      <>
                        <span className="flex flex-wrap justify-center gap-0.5" aria-hidden="true">
                          {list.slice(0, 4).map((it) => (
                            <span key={it.id} className="size-1.5 rounded-full" style={{ background: priorityColor(it.meta.entry.priority, prefs) ?? "var(--muted-foreground)" }} />
                          ))}
                        </span>
                        <span className="text-[11px] leading-none text-muted-foreground tabular" aria-hidden="true">{list.length}</span>
                      </>
                    )}
                  </button>
                  <ul className="hidden min-w-0 gap-0.5 md:grid">
                    {list.slice(0, 3).map((it) => (
                      <li key={`${it.id}-${d}`}>
                        <ItemChip item={it} conflict={conflicts.has(it.id)} onOpen={openItem} compact prefs={prefs} />
                      </li>
                    ))}
                    {list.length > 3 && (
                      <li>
                        <button type="button" className="px-1 text-xs text-primary hover:underline" onClick={() => nav({ visao: "dia", data: d })}>
                          +{list.length - 3} mais
                        </button>
                      </li>
                    )}
                  </ul>
                  {canManage && list.length === 0 && (
                    <button type="button" onClick={() => quickCreate(d)} className="sr-only focus:not-sr-only focus:text-xs">
                      Criar evento neste dia
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <TimeGrid prefs={prefs} days={view === "dia" ? [day] : shownDays} byDay={byDay} today={today} conflicts={conflicts} onOpen={openItem} onSlot={quickCreate} canManage={canManage} ownerName={ownerName} showOwner={canSeeOthers} />
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <AgendaLegend prefs={prefs} onChange={updatePrefs} />
        <span className="inline-flex items-center gap-1">
          <AlertTriangle className="size-3.5 text-warning" aria-hidden="true" /> Conflito de horário
        </span>
        <Link href="/tarefas" className="text-primary hover:underline">
          Ver todas as tarefas
        </Link>
      </div>

      <AgendaItemSheet
        entry={selected}
        onClose={() => setSelected(null)}
        owners={owners}
        meId={meId}
        canManageEvents={canManage}
        canAssignEvents={canAssign}
        canEditTasks={canEditTasks}
        canPublish={canPublish}
      />

      {dialog && (
        <EventDialog
          key={dialog.event?.id ?? `${dialog.draft?.date}-${dialog.draft?.time}`}
          open
          onOpenChange={(v) => !v && setDialog(null)}
          event={dialog.event}
          draft={dialog.draft}
          owners={owners}
          canAssign={canAssign}
          meId={meId}
        />
      )}
    </div>
  );
}

function ItemChip({ item, conflict, onOpen, compact, prefs }: { item: Item; conflict: boolean; onOpen: (i: Item) => void; compact?: boolean; prefs: AgendaPrefs }) {
  const time = item.allDay
    ? "Dia inteiro"
    : new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(item.start));
  const done = ["concluida", "concluido", "cancelado", "cancelada"].includes(item.meta.status);
  const style = AGENDA_STYLE[item.meta.entry.type];
  const look = entryLook(item.meta.entry, prefs);
  const Icon = style.icon;
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      style={look.style}
      className={cn(
        "flex w-full min-w-0 items-center gap-1 rounded border px-1 py-0.5 text-left text-xs",
        look.className,
        conflict && "ring-1 ring-warning",
        done && "line-through opacity-60",
      )}
      title={`${AGENDA_TYPE_LABEL[item.meta.entry.type]}, ${time}: ${item.title}${conflict ? " (conflito de horário)" : ""}`}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {!compact || !item.allDay ? <span className="tabular shrink-0">{time}</span> : null}
      <span className="truncate">{item.title}</span>
      {conflict && (
        <>
          <AlertTriangle className="size-3 shrink-0 text-warning" aria-hidden="true" />
          <span className="sr-only">Conflito de horário</span>
        </>
      )}
    </button>
  );
}

function TimeGrid({
  days,
  byDay,
  today,
  conflicts,
  onOpen,
  onSlot,
  canManage,
  ownerName,
  showOwner,
  prefs,
}: {
  prefs: AgendaPrefs;
  days: string[];
  byDay: Map<string, Item[]>;
  today: string;
  conflicts: Set<string>;
  onOpen: (i: Item) => void;
  onSlot: (date: string, time: string) => void;
  canManage: boolean;
  ownerName: Map<string, string>;
  showOwner: boolean;
}) {
  // A grade cresce para caber tudo: nenhum item fica fora da tela por ser muito cedo ou muito tarde.
  const timedAll = days.flatMap((d) => (byDay.get(d) ?? []).filter((i) => !i.allDay).map((i) => ({ d, i })));
  const START_HOUR = Math.min(DEFAULT_START_HOUR, ...timedAll.map(({ d, i }) => (dayKey(i.start) === d ? Math.floor(minutesOfDay(i.start) / 60) : 0)));
  const END_HOUR = Math.max(DEFAULT_END_HOUR, ...timedAll.map(({ d, i }) => (dayKey(i.end) === d ? Math.ceil(minutesOfDay(i.end) / 60) : 24)));
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  const fmtDay = (d: string) => new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

  return (
    <div className="overflow-x-auto rounded-xl border bg-surface">
      <div className="grid" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(${days.length > 1 ? "7.5rem" : "12rem"}, 1fr))` }}>
        <div className="sticky left-0 z-20 border-b bg-surface" />
        {days.map((d) => (
          <div key={d} className={cn("border-b border-l px-2 py-1.5 text-center text-xs font-medium", d === today && "text-primary")}>
            {fmtDay(d)}
          </div>
        ))}

        <div className="sticky left-0 z-20 border-b bg-surface px-1 py-1 text-[11px] text-muted-foreground">Dia todo</div>
        {days.map((d) => (
          <div key={`ad-${d}`} className="grid min-h-8 gap-0.5 border-b border-l p-0.5">
            {(byDay.get(d) ?? [])
              .filter((i) => i.allDay)
              .map((i) => (
                <ItemChip key={i.id} item={i} conflict={false} onOpen={onOpen} compact prefs={prefs} />
              ))}
          </div>
        ))}

        <div className="sticky left-0 z-20 bg-surface">
          {hours.map((h) => (
            <div key={h} className="border-b pt-0.5 pr-1 text-right text-[11px] leading-none text-muted-foreground tabular" style={{ height: HOUR_PX }}>
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        {days.map((d) => {
          const timed = (byDay.get(d) ?? []).filter((i) => !i.allDay);
          const layout = layoutDay(timed);
          return (
            <div key={`g-${d}`} className="relative border-l" style={{ height: hours.length * HOUR_PX }}>
              {hours.map((h) => (
                <button
                  key={h}
                  type="button"
                  disabled={!canManage}
                  onClick={() => onSlot(d, `${String(h).padStart(2, "0")}:00`)}
                  className="block w-full border-b hover:bg-muted/50 focus-visible:bg-muted disabled:hover:bg-transparent"
                  style={{ height: HOUR_PX }}
                  aria-label={canManage ? `Criar evento em ${d.split("-").reverse().join("/")} às ${h}h` : undefined}
                  tabIndex={canManage ? 0 : -1}
                />
              ))}
              {timed.map((it) => {
                const startMin = dayKey(it.start) === d ? minutesOfDay(it.start) : 0;
                const endMin = dayKey(it.end) === d ? minutesOfDay(it.end) : 24 * 60;
                const top = Math.max(0, ((startMin - START_HOUR * 60) / 60) * HOUR_PX);
                const height = Math.max(20, ((Math.min(endMin, END_HOUR * 60) - Math.max(startMin, START_HOUR * 60)) / 60) * HOUR_PX);
                const pos = layout.get(it.id) ?? { col: 0, cols: 1 };
                const conflict = conflicts.has(it.id);
                const look = entryLook(it.meta.entry, prefs);
                const clock = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(it.start));
                // Item curto: hora e título na mesma linha, em vez de um cortar o outro.
                const short = height < 40;
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => onOpen(it)}
                    className={cn(
                      "absolute z-10 overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-xs leading-tight shadow-xs",
                      look.className,
                      conflict && "border-warning ring-1 ring-warning",
                      ["concluida", "concluido", "cancelado", "cancelada"].includes(it.meta.status) && "opacity-60 line-through",
                    )}
                    title={`${AGENDA_TYPE_LABEL[it.meta.entry.type]}: ${it.title}`}
                    style={{ ...look.style, top, height, left: `calc(${(pos.col / pos.cols) * 100}% + 2px)`, width: `calc(${100 / pos.cols}% - 4px)` }}
                  >
                    <span className="flex min-w-0 items-center gap-1 font-medium">
                      {conflict && <AlertTriangle className="size-3 shrink-0 text-warning" aria-label="Conflito de horário" />}
                      {short && <span className="shrink-0 font-normal tabular opacity-80">{clock}</span>}
                      <span className="truncate">{it.title}</span>
                    </span>
                    {!short && (
                      <span className="block truncate tabular opacity-80">
                        {clock}
                        {showOwner && it.ownerId ? ` · ${ownerName.get(it.ownerId) ?? ""}` : ""}
                      </span>
                    )}
                    {!short && height >= 56 && <PriorityTag priority={it.meta.entry.priority} prefs={prefs} />}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
