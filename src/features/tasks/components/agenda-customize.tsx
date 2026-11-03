"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Palette } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { AGENDA_TYPE_LABEL, type AgendaEntry, type AgendaPriority, type AgendaType } from "@/domain/calendar/agenda";
import { DEFAULT_AGENDA_PREFS, PRIORITIES, PRIORITY_LABEL, priorityColor, showsPriorityTag, SWATCH_LABEL, SWATCHES, type AgendaPrefs, type Swatch } from "@/domain/calendar/agenda-prefs";
import { saveAgendaPrefs } from "../actions";
import { AGENDA_STYLE } from "./agenda-item-sheet";

/** A escolha vale na hora e é salva logo depois, para valer também no celular e no computador. */
export function useAgendaPrefs(initial: AgendaPrefs) {
  const [prefs, setPrefs] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const update = useCallback((patch: Partial<AgendaPrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void saveAgendaPrefs(next).then((res) => {
          if (!res.ok) toast.error(res.message ?? "Não foi possível salvar a personalização.");
        });
      }, 400);
      return next;
    });
  }, []);
  return [prefs, update] as const;
}

/** Aparência do item: pintado pela prioridade, ou na cor do tipo com a faixa da prioridade. */
export function entryLook(entry: Pick<AgendaEntry, "type" | "priority">, prefs: AgendaPrefs): { className: string; style?: CSSProperties } {
  const color = priorityColor(entry.priority, prefs);
  if (prefs.colorBy === "prioridade") {
    return {
      className: "border-border text-foreground",
      style: color ? { background: `color-mix(in oklab, ${color} 14%, var(--surface))`, borderColor: `color-mix(in oklab, ${color} 45%, var(--border))`, borderLeft: `4px solid ${color}` } : { background: "var(--surface)" },
    };
  }
  const urgent = entry.priority === "alta" || entry.priority === "urgente";
  return { className: AGENDA_STYLE[entry.type].className, style: urgent && color ? { borderLeft: `4px solid ${color}` } : undefined };
}

export function PriorityTag({ priority, prefs }: { priority: AgendaEntry["priority"]; prefs: AgendaPrefs }) {
  if (!priority || !showsPriorityTag(priority, prefs)) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] leading-none font-semibold text-foreground">
      <span className="size-2 rounded-full" style={{ background: SWATCHES[prefs.priorityColors[priority]] }} aria-hidden="true" />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

/** Legenda que também filtra: tocar num tipo esconde ou mostra esse tipo. */
export function AgendaLegend({ prefs, onChange }: { prefs: AgendaPrefs; onChange: (patch: Partial<AgendaPrefs>) => void }) {
  return (
    <ul className="flex flex-wrap gap-1 text-xs" aria-label="Tipos de item: toque para mostrar ou esconder">
      {(Object.keys(AGENDA_TYPE_LABEL) as AgendaType[]).map((t) => {
        const Icon = AGENDA_STYLE[t].icon;
        const hidden = prefs.hiddenTypes.includes(t);
        return (
          <li key={t}>
            <button
              type="button"
              aria-pressed={!hidden}
              onClick={() => onChange({ hiddenTypes: hidden ? prefs.hiddenTypes.filter((x) => x !== t) : [...prefs.hiddenTypes, t] })}
              className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted", hidden && "line-through opacity-50")}
            >
              <span className={cn("grid size-4 place-items-center rounded border", AGENDA_STYLE[t].className)}>
                <Icon className="size-3" aria-hidden="true" />
              </span>
              {AGENDA_TYPE_LABEL[t]}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="grid gap-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([k, text]) => (
          <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)} className={cn("rounded-lg border px-3 py-1.5 text-sm transition-colors", value === k ? "border-primary bg-accent font-medium text-accent-foreground" : "bg-surface text-muted-foreground hover:text-foreground")}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AgendaCustomize({ prefs, onChange, withDefaultTab = false }: { prefs: AgendaPrefs; onChange: (patch: Partial<AgendaPrefs>) => void; withDefaultTab?: boolean }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Palette aria-hidden="true" /> Personalizar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Personalizar a agenda</DialogTitle>
          <DialogDescription>Vale só para você, em todos os seus aparelhos.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <Choice label="Pintar os itens por" value={prefs.colorBy} options={[["tipo", "Tipo"], ["prioridade", "Prioridade"]]} onChange={(colorBy) => onChange({ colorBy })} />
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium">Cor de cada prioridade</legend>
            {PRIORITIES.map((p: AgendaPriority) => (
              <div
                key={p}
                role="radiogroup"
                aria-label={`Cor da prioridade ${PRIORITY_LABEL[p]}`}
                className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2"
                onKeyDown={(e) => {
                  const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                  if (!step) return;
                  e.preventDefault();
                  const names = Object.keys(SWATCHES) as Swatch[];
                  const next = (names.indexOf(prefs.priorityColors[p]) + step + names.length) % names.length;
                  onChange({ priorityColors: { ...prefs.priorityColors, [p]: names[next] } });
                  e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
                }}
              >
                <span className="text-sm">{PRIORITY_LABEL[p]}</span>
                <div className="flex flex-wrap gap-1">
                  {(Object.keys(SWATCHES) as Swatch[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={prefs.priorityColors[p] === s}
                      tabIndex={prefs.priorityColors[p] === s ? 0 : -1}
                      aria-label={SWATCH_LABEL[s]}
                      title={SWATCH_LABEL[s]}
                      onClick={() => onChange({ priorityColors: { ...prefs.priorityColors, [p]: s } })}
                      className={cn("hub-hit size-7 rounded-full border-2 border-surface ring-1 ring-border transition-shadow", prefs.priorityColors[p] === s && "ring-2 ring-foreground")}
                      style={{ background: SWATCHES[s] }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
          <Choice label="Tamanho dos itens" value={prefs.density} options={[["confortavel", "Confortável"], ["compacta", "Compacto"]]} onChange={(density) => onChange({ density })} />
          {withDefaultTab && <Choice label="Abrir a agenda em" value={prefs.defaultTab ?? "padrao"} options={[["padrao", "Padrão"], ["hoje", "Hoje"], ["semana", "Semana"], ["mes", "Mês"]]} onChange={(v) => onChange({ defaultTab: v === "padrao" ? null : v })} />}
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium">
            Mostrar sábado e domingo
            <Switch checked={prefs.weekends} onCheckedChange={(weekends) => onChange({ weekends })} aria-label="Mostrar sábado e domingo" />
          </label>
          <fieldset className="grid gap-1">
            <legend className="mb-1 text-sm font-medium">O que aparece na agenda</legend>
            {(Object.keys(AGENDA_TYPE_LABEL) as AgendaType[]).map((t) => (
              <label key={t} className="flex min-h-10 items-center gap-3 text-sm">
                <Checkbox checked={!prefs.hiddenTypes.includes(t)} onCheckedChange={(v) => onChange({ hiddenTypes: v ? prefs.hiddenTypes.filter((x) => x !== t) : [...prefs.hiddenTypes, t] })} />
                {AGENDA_TYPE_LABEL[t]}
              </label>
            ))}
          </fieldset>
          <Button variant="ghost" className="justify-self-start" onClick={() => onChange(DEFAULT_AGENDA_PREFS)}>
            Voltar ao padrão
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
