"use client";

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
import { addDays, AGENDA_TYPE_LABEL, filterAgenda, groupByDay, listDays, MAX_RANGE_DAYS, monthRange, validRange, weekRange, type AgendaEntry, type AgendaFilter, type AgendaStatusGroup, type AgendaType } from "@/domain/calendar/agenda";
import { todayLocal } from "@/domain/shared/dates";
import { deleteAgendaFilter, getAgenda, saveAgendaFilter } from "../actions";
import { AGENDA_STYLE, AgendaItemSheet, agendaTime } from "./agenda-item-sheet";

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
}) {
  const router = useRouter();
  const today = todayLocal();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [anchor, setAnchor] = useState(today);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 30));
  const [q, setQ] = useState("");
  const [type, setType] = useState<AgendaType | null>(null);
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

  const filter: AgendaFilter = { q, type, ownerIds, clientId, status };
  const visible = useMemo(() => filterAgenda(entries, { q, type, ownerIds, clientId, status }), [entries, q, type, ownerIds, clientId, status]);
  const byDay = useMemo(() => groupByDay(visible), [visible]);
  const hasFilters = Boolean(q || type || ownerIds.length || clientId || status);

  function applySaved(f: AgendaFilter) {
    setQ(f.q ?? "");
    setType(f.type ?? null);
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
      <div role="tablist" aria-label="Visão da agenda" className="flex gap-1 overflow-x-auto border-b">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
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
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm">
            De
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </label>
          <label className="grid gap-1 text-sm">
            Até
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </label>
          {!rangeOk && (
            <p role="alert" className="pb-2 text-sm text-danger">
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
          <h3 className="ml-1 text-sm font-semibold first-letter:uppercase" aria-live="polite">
            {heading}
          </h3>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_repeat(3,minmax(9rem,12rem))]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar na agenda…" aria-label="Pesquisar na agenda" className="pl-8" />
        </div>
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
      </div>

      {tab !== "minhas" && owners.length > 1 && (
        <Select value={ownerIds.length === 1 ? ownerIds[0] : ALL} onValueChange={(v) => setOwnerIds(v === ALL ? [] : [v])}>
          <SelectTrigger className="w-full sm:w-64" aria-label="Responsável">
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

      <Legend />

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
        (visible.length === 0 ? (
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
          <WeekBoard days={listDays(range.from, range.to)} byDay={byDay} today={today} onOpen={setSelected} />
        ) : tab === "mes" ? (
          <MonthBoard anchor={anchor} days={listDays(range.from, range.to)} byDay={byDay} today={today} selectedDay={monthDay} onDay={setMonthDay} onOpen={setSelected} />
        ) : (
          <DayGroups days={tab === "hoje" ? [anchor] : listDays(range.from, range.to)} byDay={byDay} today={today} onOpen={setSelected} />
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

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Tipos de item">
      {(Object.keys(AGENDA_TYPE_LABEL) as AgendaType[]).map((t) => {
        const Icon = AGENDA_STYLE[t].icon;
        return (
          <li key={t} className="inline-flex items-center gap-1">
            <span className={cn("grid size-4 place-items-center rounded border", AGENDA_STYLE[t].className)}>
              <Icon className="size-3" aria-hidden="true" />
            </span>
            {AGENDA_TYPE_LABEL[t]}
          </li>
        );
      })}
    </ul>
  );
}

function EntryCard({ entry, onOpen, compact }: { entry: AgendaEntry; onOpen: (e: AgendaEntry) => void; compact?: boolean }) {
  const style = AGENDA_STYLE[entry.type];
  const off = ["cancelado", "cancelada", "concluido", "concluida"].includes(entry.status);
  return (
    <button
      type="button"
      onClick={() => onOpen(entry)}
      className={cn("grid w-full min-w-0 gap-0.5 rounded-md border px-2 py-1.5 text-left text-sm transition-colors hover:brightness-95", style.className, off && "opacity-70")}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-xs">
        <style.icon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="tabular shrink-0">{agendaTime(entry)}</span>
        {!compact && <span className="truncate">{AGENDA_TYPE_LABEL[entry.type]}</span>}
        <span className="sr-only">{compact ? AGENDA_TYPE_LABEL[entry.type] : ""}</span>
      </span>
      <span className={cn("font-medium break-words", off && "line-through")}>{entry.title}</span>
      {!compact && (entry.clientName || entry.boardName) && (
        <span className="truncate text-xs opacity-80">{[entry.clientName, entry.boardName && (entry.listName ? `${entry.boardName} › ${entry.listName}` : entry.boardName)].filter(Boolean).join(", ")}</span>
      )}
      {off && <span className="text-xs">{entry.statusLabel}</span>}
    </button>
  );
}

function DayGroups({ days, byDay, today, onOpen }: { days: string[]; byDay: Map<string, AgendaEntry[]>; today: string; onOpen: (e: AgendaEntry) => void }) {
  const withItems = days.filter((d) => byDay.has(d));
  return (
    <div className="grid gap-4">
      {withItems.map((d) => (
        <section key={d} aria-label={dayTitle(d)} className="grid gap-1.5">
          {days.length > 1 && <h4 className={cn("text-xs font-semibold first-letter:uppercase", d === today && "text-primary")}>{dayTitle(d)}</h4>}
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {byDay.get(d)!.map((e) => (
              <li key={`${e.source}-${e.id}-${d}`} className="min-w-0">
                <EntryCard entry={e} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Colunas por dia sem posição absoluta: vários itens no mesmo horário empilham, nunca se sobrepõem. */
function WeekBoard({ days, byDay, today, onOpen }: { days: string[]; byDay: Map<string, AgendaEntry[]>; today: string; onOpen: (e: AgendaEntry) => void }) {
  return (
    <div className="grid gap-2 lg:grid-cols-7">
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
                    <EntryCard entry={e} onOpen={onOpen} compact />
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

function MonthBoard({ anchor, days, byDay, today, selectedDay, onDay, onOpen }: { anchor: string; days: string[]; byDay: Map<string, AgendaEntry[]>; today: string; selectedDay: string | null; onDay: (d: string) => void; onOpen: (e: AgendaEntry) => void }) {
  const current = selectedDay ?? (dayKey(new Date(`${today}T12:00:00Z`)).slice(0, 7) === anchor.slice(0, 7) ? today : null);
  return (
    <div className="grid gap-3">
      <div className="rounded-lg border">
        <div className="grid grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground" aria-hidden="true">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const outside = d.slice(0, 7) !== anchor.slice(0, 7);
            return (
              <button
                key={d}
                type="button"
                onClick={() => onDay(d)}
                aria-pressed={current === d}
                aria-label={`${dayTitle(d)}: ${list.length} item(ns)`}
                className={cn("grid min-h-14 content-start justify-items-center gap-1 border-r border-b p-1 last:border-r-0 hover:bg-accent sm:min-h-20", outside && "bg-muted/40 text-muted-foreground", current === d && "bg-accent ring-2 ring-ring ring-inset")}
              >
                <span className={cn("grid size-6 place-items-center rounded-full text-xs tabular", d === today && "bg-primary font-semibold text-primary-foreground")}>{Number(d.slice(8))}</span>
                {list.length > 0 && (
                  <>
                    <span className="flex flex-wrap justify-center gap-0.5" aria-hidden="true">
                      {[...new Set(list.map((e) => e.type))].slice(0, 4).map((t) => {
                        const Icon = AGENDA_STYLE[t].icon;
                        return (
                          <span key={t} className={cn("grid size-4 place-items-center rounded border", AGENDA_STYLE[t].className)}>
                            <Icon className="size-3" />
                          </span>
                        );
                      })}
                    </span>
                    <span className="text-[11px] tabular text-muted-foreground">{list.length}</span>
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
                  <EntryCard entry={e} onOpen={onOpen} />
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
