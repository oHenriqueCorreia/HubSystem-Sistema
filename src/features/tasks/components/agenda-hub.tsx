"use client";

import { MobileFilters } from "@/components/app/mobile-filters";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dayKey } from "@/domain/calendar";
import { addDays, AGENDA_TYPE_LABEL, filterAgenda, groupByDay, listDays, MAX_RANGE_DAYS, monthRange, validRange, weekRange, type AgendaEntry, type AgendaFilter, type AgendaPriority, type AgendaStatusGroup, type AgendaType } from "@/domain/calendar/agenda";
import { DEFAULT_AGENDA_PREFS, PRIORITIES, PRIORITY_LABEL, priorityColor, visibleDays, type AgendaPrefs } from "@/domain/calendar/agenda-prefs";
import { todayLocal } from "@/domain/shared/dates";
import { deleteAgendaFilter, getAgenda, saveAgendaFilter } from "../actions";
import { AGENDA_STYLE, AgendaItemSheet, agendaTime } from "./agenda-item-sheet";
import { AgendaCustomize, AgendaLegend, entryLook, PriorityTag, useAgendaPrefs } from "./agenda-customize";

type Owner = { id: string; full_name: string; email: string };
export type SavedAgendaFilter = { name: string; filter: AgendaFilter };
type Tab = "hoje" | "semana" | "mes" | "periodo" | "minhas";

const TABS: [Tab, string][] = [
  ["hoje", "Hoje"],
  ["semana", "Semana"],
  ["mes", "Mês"],
  ["periodo", "Período"],
  ["minhas", "Minhas agendas"],
];
const ALL = "__todos__";
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const utcDate = (d: string) => new Date(`${d}T12:00:00Z`);
const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { ...o, timeZone: "UTC" }).format(utcDate(d));
const dayTitle = (d: string) => fmt(d, { weekday: "long", day: "numeric", month: "long" });

function rangeFor(tab: Tab, anchor: string, from: string, to: string) {
  if (tab === "hoje") return { from: anchor, to: anchor };
  if (tab === "semana") return weekRange(anchor);
  if (tab === "mes") return monthRange(anchor);
  if (tab === "periodo") return { from, to };
  return { from: anchor, to: addDays(anchor, 13) };
}

function shift(tab: Tab, anchor: string, dir: -1 | 1) {
  if (tab === "hoje") return addDays(anchor, dir);
  if (tab === "semana") return addDays(anchor, dir * 7);
  if (tab === "minhas") return addDays(anchor, dir * 14);
  const d = utcDate(`${anchor.slice(0, 7)}-01`);
  d.setUTCMonth(d.getUTCMonth() + dir);
  return d.toISOString().slice(0, 10);
}

/** Todas as agendas numa seção só. Os itens vêm das tabelas de origem, então nada aqui é cópia. */
export function AgendaHub({
  owners,
  clients,
  meId,
  canManageEvents,
  canAssignEvents,
  canEditTasks,
  canPublish = false,
  savedFilters,
  initialTab = "hoje",
  initialPrefs = DEFAULT_AGENDA_PREFS,
}: {
  owners: Owner[];
  clients: { id: string; legal_name: string }[];
  meId: string;
  canManageEvents: boolean;
  canAssignEvents: boolean;
  canEditTasks: boolean;
  canPublish?: boolean;
  savedFilters: SavedAgendaFilter[];
  initialTab?: Tab;
  initialPrefs?: AgendaPrefs;
}) {
  const router = useRouter();
  const today = todayLocal();
  const [prefs, updatePrefs] = useAgendaPrefs(initialPrefs);
  const [tab, setTab] = useState<Tab>(initialPrefs.defaultTab ?? initialTab);
  const [anchor, setAnchor] = useState(today);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 30));
  const [q, setQ] = useState("");
  const [type, setType] = useState<AgendaType | null>(null);
  const [priority, setPriority] = useState<AgendaPriority | null>(null);
  const [ownerIds, setOwnerIds] = useState<string[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [status, setStatus] = useState<AgendaStatusGroup | null>(null);
  const [entries, setEntries] = useState<AgendaEntry[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [selected, setSelected] = useState<AgendaEntry | null>(null);
  const [monthDay, setMonthDay] = useState<string | null>(null);
  const [filterName, setFilterName] = useState("");
  const [saving, startSaving] = useTransition();

  const range = useMemo(() => rangeFor(tab, anchor, from, to), [tab, anchor, from, to]);
  const rangeOk = validRange(range.from, range.to);

  const load = useCallback(async () => {
    if (!rangeOk) return;
    setState("loading");
    const res = await getAgenda({ from: range.from, to: range.to }).catch(() => null);
    if (!res?.ok) {
      setErrorMessage(res?.message ?? "Sem conexão com o servidor.");
      setState("error");
      return;
    }
    setEntries(res.data);
    setState("ready");
  }, [range.from, range.to, rangeOk]);

  useEffect(() => {
    // Carregamento da faixa de datas visível: é uma leitura externa, não dado derivado.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const filter: AgendaFilter = { q, type, priority, ownerIds, clientId, status };
  const visible = useMemo(() => filterAgenda(entries, { q, type, priority, ownerIds, clientId, status }).filter((e) => !prefs.hiddenTypes.includes(e.type)), [entries, q, type, priority, ownerIds, clientId, status, prefs.hiddenTypes]);
  const byDay = useMemo(() => groupByDay(visible), [visible]);
  const hasFilters = Boolean(q || type || priority || ownerIds.length || clientId || status);

  function applySaved(f: AgendaFilter) {
    setQ(f.q ?? "");
    setType(f.type ?? null);
    setPriority(f.priority ?? null);
    setOwnerIds(f.ownerIds ?? []);
    setClientId(f.clientId ?? null);
    setStatus(f.status ?? null);
  }

  function clearFilters() {
    applySaved({});
  }

  function saveCurrent() {
    startSaving(async () => {
      const res = await saveAgendaFilter({ name: filterName, filter });
      if (!res.ok) return void toast.error(res.fieldErrors?.name?.[0] ?? res.message);
      toast.success(res.message);
      setFilterName("");
      router.refresh();
    });
  }

  const heading =
    tab === "hoje"
      ? fmt(anchor, { weekday: "long", day: "numeric", month: "long" })
      : tab === "mes"
        ? fmt(anchor, { month: "long", year: "numeric" })
        : tab === "periodo"
          ? null
          : `${fmt(range.from, { day: "numeric", month: "short" })} a ${fmt(range.to, { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="grid min-w-0 gap-3">
      <div role="group" aria-label="Visão da agenda" className="flex gap-1 overflow-x-auto border-b">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={tab === k}
            onClick={() => {
              setTab(k);
              setMonthDay(null);
            }}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap", tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "periodo" ? (
        <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
          <label className="grid min-w-0 gap-1 text-sm">
            De
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full min-w-0 sm:w-40" />
          </label>
          <label className="grid min-w-0 gap-1 text-sm">
            Até
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full min-w-0 sm:w-40" />
          </label>
          <div className="col-span-2 sm:ml-auto">
            <AgendaCustomize prefs={prefs} onChange={updatePrefs} withDefaultTab />
          </div>
          {!rangeOk && (
            <p role="alert" className="col-span-2 pb-2 text-sm text-danger">
              Escolha uma data final depois da inicial, em até {MAX_RANGE_DAYS} dias.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setAnchor(today)}>
            Hoje
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Período anterior" onClick={() => setAnchor((a) => shift(tab, a, -1))}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Próximo período" onClick={() => setAnchor((a) => shift(tab, a, 1))}>
            <ChevronRight aria-hidden="true" />
          </Button>
          <h3 className="order-last min-w-0 basis-full text-sm font-semibold first-letter:uppercase sm:order-none sm:ml-1 sm:flex-1 sm:basis-0" aria-live="polite">
            {heading}
          </h3>
          <div className="ml-auto sm:ml-0">
            <AgendaCustomize prefs={prefs} onChange={updatePrefs} withDefaultTab />
          </div>
        </div>
      )}

      <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_repeat(4,minmax(9rem,12rem))]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar na agenda…" aria-label="Pesquisar na agenda" className="pl-8" />
        </div>
        <MobileFilters active={[type, priority, clientId, status, tab !== "minhas" && ownerIds.length].filter(Boolean).length}>
        <Select value={type ?? ALL} onValueChange={(v) => setType(v === ALL ? null : (v as AgendaType))}>
          <SelectTrigger className="w-full" aria-label="Tipo">
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
        <Select value={priority ?? ALL} onValueChange={(v) => setPriority(v === ALL ? null : (v as AgendaPriority))}>
          <SelectTrigger className="w-full" aria-label="Prioridade"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as prioridades</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={clientId ?? ALL} onValueChange={(v) => setClientId(v === ALL ? null : v)}>
          <SelectTrigger className="w-full" aria-label="Cliente">
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
        <Select value={status ?? ALL} onValueChange={(v) => setStatus(v === ALL ? null : (v as AgendaStatusGroup))}>
          <SelectTrigger className="w-full" aria-label="Situação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Abertos e concluídos</SelectItem>
            <SelectItem value="aberto">Só em aberto</SelectItem>
            <SelectItem value="concluido">Só concluídos</SelectItem>
            <SelectItem value="cancelado">Só cancelados</SelectItem>
          </SelectContent>
        </Select>
      {tab !== "minhas" && owners.length > 1 && (
        <Select value={ownerIds.length === 1 ? ownerIds[0] : ALL} onValueChange={(v) => setOwnerIds(v === ALL ? [] : [v])}>
          <SelectTrigger className="w-full" aria-label="Responsável">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{ownerIds.length > 1 ? `${ownerIds.length} agendas selecionadas` : "Todos os responsáveis"}</SelectItem>
            {owners.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.id === meId ? "Minha agenda" : o.full_name || o.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
        </MobileFilters>
      </div>

      {tab === "minhas" && (
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
          <fieldset className="grid gap-1.5">
            <legend className="text-sm font-medium">Agendas que você pode ver</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {owners.map((o) => (
                <label key={o.id} className="flex min-h-8 items-center gap-2 text-sm">
                  <Checkbox checked={ownerIds.includes(o.id)} onCheckedChange={(v) => setOwnerIds((list) => (v ? [...list, o.id] : list.filter((id) => id !== o.id)))} />
                  {o.id === meId ? "Minha agenda" : o.full_name || o.email}
                </label>
              ))}
            </div>
          </fieldset>
          {savedFilters.length > 0 && (
            <div className="grid gap-1.5">
              <p className="text-sm font-medium">Filtros salvos</p>
              <ul className="flex flex-wrap gap-2">
                {savedFilters.map((f) => (
                  <li key={f.name} className="flex items-center rounded-md border bg-surface">
                    <button type="button" className="px-2 py-1 text-sm hover:underline" onClick={() => applySaved(f.filter)}>
                      {f.name}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Apagar o filtro ${f.name}`}
                      onClick={() =>
                        startSaving(async () => {
                          const res = await deleteAgendaFilter({ name: f.name });
                          if (!res.ok) return void toast.error(res.message);
                          router.refresh();
                        })
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveCurrent();
            }}
          >
            <Input value={filterName} maxLength={40} onChange={(e) => setFilterName(e.target.value)} placeholder="Nome do filtro…" aria-label="Nome do filtro" className="w-56" />
            <Button type="submit" variant="outline" size="sm" disabled={saving || !filterName.trim() || !hasFilters}>
              <Save aria-hidden="true" /> Salvar filtros atuais
            </Button>
          </form>
        </div>
      )}

      <AgendaLegend prefs={prefs} onChange={updatePrefs} />

      {state === "loading" && (
        <div className="grid gap-2" aria-busy="true" aria-label="Carregando a agenda">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-3/4" />
        </div>
      )}
      {state === "error" && (
        <div role="alert" className="grid justify-items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft p-3 text-sm">
          <p>Não foi possível carregar a agenda. {errorMessage}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw aria-hidden="true" /> Tentar de novo
          </Button>
        </div>
      )}
      {state === "ready" &&
        (visible.length === 0 && tab !== "mes" ? (
          <div className="grid justify-items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            <CalendarDays className="size-6" aria-hidden="true" />
            <p>{hasFilters ? "Nada encontrado com estes filtros." : "Nada na agenda neste período."}</p>
            {hasFilters && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Limpar filtros
              </Button>
            )}
          </div>
        ) : tab === "semana" ? (
          <WeekBoard days={visibleDays(listDays(range.from, range.to), prefs)} byDay={byDay} today={today} onOpen={setSelected} prefs={prefs} />
        ) : tab === "mes" ? (
          <MonthBoard anchor={anchor} days={visibleDays(listDays(range.from, range.to), prefs)} byDay={byDay} today={today} selectedDay={monthDay} onDay={setMonthDay} onOpen={setSelected} prefs={prefs} />
        ) : (
          <DayGroups days={tab === "hoje" ? [anchor] : listDays(range.from, range.to)} byDay={byDay} today={today} onOpen={setSelected} prefs={prefs} />
        ))}

      <AgendaItemSheet
        entry={selected}
        onClose={() => setSelected(null)}
        onChanged={() => void load()}
        owners={owners}
        meId={meId}
        canManageEvents={canManageEvents}
        canAssignEvents={canAssignEvents}
        canEditTasks={canEditTasks}
        canPublish={canPublish}
      />
    </div>
  );
}

function EntryCard({ entry, onOpen, compact, prefs }: { entry: AgendaEntry; onOpen: (e: AgendaEntry) => void; compact?: boolean; prefs: AgendaPrefs }) {
  const style = AGENDA_STYLE[entry.type];
  const look = entryLook(entry, prefs);
  const off = ["cancelado", "cancelada", "concluido", "concluida"].includes(entry.status);
  const tight = prefs.density === "compacta";
  return (
    <button
      type="button"
      onClick={() => onOpen(entry)}
      style={look.style}
      className={cn("grid w-full min-w-0 rounded-lg border text-left text-sm transition-colors hover:brightness-95", tight ? "gap-0 px-2 py-1" : "gap-1 px-2.5 py-2", look.className, off && "opacity-70")}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
        <style.icon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="font-medium whitespace-nowrap tabular">{agendaTime(entry)}</span>
        {!compact && <span className="opacity-80">{AGENDA_TYPE_LABEL[entry.type]}</span>}
        <span className="sr-only">{compact ? AGENDA_TYPE_LABEL[entry.type] : ""}</span>
        <span className="ml-auto">
          <PriorityTag priority={entry.priority} prefs={prefs} />
        </span>
      </span>
      <span className={cn("min-w-0 font-medium break-words", tight && "line-clamp-1", !tight && compact && "line-clamp-3", off && "line-through")}>{entry.title}</span>
      {!compact && !tight && (entry.clientName || entry.boardName) && (
        <span className="truncate text-xs opacity-80">{[entry.clientName, entry.boardName && (entry.listName ? `${entry.boardName} › ${entry.listName}` : entry.boardName)].filter(Boolean).join(", ")}</span>
      )}
      {off && <span className="text-xs">{entry.statusLabel}</span>}
    </button>
  );
}

function DayGroups({ days, byDay, today, onOpen, prefs }: { days: string[]; byDay: Map<string, AgendaEntry[]>; today: string; onOpen: (e: AgendaEntry) => void; prefs: AgendaPrefs }) {
  const withItems = days.filter((d) => byDay.has(d));
  return (
    <div className="grid gap-4">
      {withItems.map((d) => (
        <section key={d} aria-label={dayTitle(d)} className="grid gap-1.5">
          {days.length > 1 && <h4 className={cn("text-xs font-semibold first-letter:uppercase", d === today && "text-primary")}>{dayTitle(d)}</h4>}
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {byDay.get(d)!.map((e) => (
              <li key={`${e.source}-${e.id}-${d}`} className="min-w-0">
                <EntryCard entry={e} onOpen={onOpen} prefs={prefs} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Colunas por dia sem posição absoluta: vários itens no mesmo horário empilham, nunca se sobrepõem. */
function WeekBoard({ days, byDay, today, onOpen, prefs }: { days: string[]; byDay: Map<string, AgendaEntry[]>; today: string; onOpen: (e: AgendaEntry) => void; prefs: AgendaPrefs }) {
  return (
    <div className={cn("grid gap-2", days.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-7")}>
      {days.map((d) => {
        const list = byDay.get(d) ?? [];
        return (
          <section key={d} aria-label={dayTitle(d)} className={cn("grid min-w-0 content-start gap-1.5 rounded-lg border p-1.5", d === today && "border-primary", !list.length && "max-lg:hidden")}>
            <h4 className={cn("px-0.5 text-xs font-semibold first-letter:uppercase", d === today && "text-primary")}>
              <span className="lg:hidden">{dayTitle(d)}</span>
              <span className="hidden lg:inline">{fmt(d, { weekday: "short", day: "numeric" })}</span>
            </h4>
            {list.length === 0 ? (
              <p className="px-0.5 text-xs text-muted-foreground">Livre</p>
            ) : (
              <ul className="grid gap-1">
                {list.map((e) => (
                  <li key={`${e.source}-${e.id}-${d}`} className="min-w-0">
                    <EntryCard entry={e} onOpen={onOpen} compact prefs={prefs} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function MonthBoard({ anchor, days, byDay, today, selectedDay, onDay, onOpen, prefs }: { anchor: string; days: string[]; byDay: Map<string, AgendaEntry[]>; today: string; selectedDay: string | null; onDay: (d: string) => void; onOpen: (e: AgendaEntry) => void; prefs: AgendaPrefs }) {
  const current = selectedDay ?? (dayKey(new Date(`${today}T12:00:00Z`)).slice(0, 7) === anchor.slice(0, 7) ? today : null);
  const columns = { gridTemplateColumns: `repeat(${prefs.weekends ? 7 : 5}, minmax(0, 1fr))` };
  return (
    <div className="grid gap-3">
      <div className="min-w-0 overflow-hidden rounded-lg border bg-surface">
        <div className="grid border-b text-center text-xs font-medium text-muted-foreground" style={columns} aria-hidden="true">
          {WEEKDAYS.filter((_, i) => prefs.weekends || (i !== 0 && i !== 6)).map((w) => (
            <div key={w} className="py-1.5">
              {w}
            </div>
          ))}
        </div>
        <div className="grid" style={columns}>
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const outside = d.slice(0, 7) !== anchor.slice(0, 7);
            const urgent = list.some((e) => e.priority === "urgente");
            return (
              <button
                key={d}
                type="button"
                onClick={() => onDay(d)}
                aria-pressed={current === d}
                aria-label={`${dayTitle(d)}: ${list.length} ${list.length === 1 ? "item" : "itens"}${urgent ? ", com urgência" : ""}`}
                className={cn("flex min-h-16 min-w-0 flex-col items-center gap-1 overflow-hidden border-r border-b p-1 transition-colors hover:bg-accent md:min-h-28 md:items-stretch", outside && "bg-muted/40 text-muted-foreground", current === d && "bg-accent ring-2 ring-ring ring-inset")}
              >
                <span className={cn("grid size-6 shrink-0 place-items-center self-center rounded-full text-xs tabular md:self-start", d === today && "bg-primary font-semibold text-primary-foreground")}>{Number(d.slice(8))}</span>
                {list.length > 0 && (
                  <>
                    {/* Celular: pontos com a cor de cada item e o total escrito, sem texto espremido. */}
                    <span className="flex flex-wrap justify-center gap-0.5 md:hidden" aria-hidden="true">
                      {list.slice(0, 4).map((e) => (
                        <span key={`${e.source}-${e.id}`} className="size-1.5 rounded-full" style={{ background: priorityColor(e.priority, prefs) ?? "var(--muted-foreground)" }} />
                      ))}
                    </span>
                    <span className={cn("text-[11px] leading-none tabular text-muted-foreground md:hidden", urgent && "font-bold text-danger")}>{list.length}</span>
                    {/* Computador: os próprios itens, até caber. */}
                    <span className="hidden min-w-0 gap-0.5 md:grid" aria-hidden="true">
                      {list.slice(0, 3).map((e) => {
                        const look = entryLook(e, prefs);
                        return (
                          <span key={`${e.source}-${e.id}`} style={look.style} className={cn("min-w-0 truncate rounded border px-1 py-0.5 text-left text-[11px] leading-tight", look.className)}>
                            {e.title}
                          </span>
                        );
                      })}
                      {list.length > 3 && <span className="text-left text-[11px] text-muted-foreground tabular">+{list.length - 3} mais</span>}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {current ? (
        <section aria-label={dayTitle(current)} aria-live="polite" className="grid gap-1.5">
          <h4 className="text-xs font-semibold first-letter:uppercase">{dayTitle(current)}</h4>
          {byDay.get(current)?.length ? (
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {byDay.get(current)!.map((e) => (
                <li key={`${e.source}-${e.id}`} className="min-w-0">
                  <EntryCard entry={e} onOpen={onOpen} prefs={prefs} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nada neste dia.</p>
          )}
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">Escolha um dia para ver os itens.</p>
      )}
    </div>
  );
}
