import { AlarmClock, CalendarClock, CalendarX2, CircleDashed } from "lucide-react";
import { cn } from "cn";
import { formatDateTime, formatRelative } from "@/domain/shared/dates";
import { nextContactState, type TagColor } from "../types";

// Pares de fundo/texto com contraste AA nos dois temas.
const TAG_STYLES: Record<TagColor, string> = {
  slate: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100",
  teal: "bg-teal-100 text-teal-900 dark:bg-teal-900/60 dark:text-teal-100",
  blue: "bg-blue-100 text-blue-900 dark:bg-blue-900/60 dark:text-blue-100",
  violet: "bg-violet-100 text-violet-900 dark:bg-violet-900/60 dark:text-violet-100",
  rose: "bg-rose-100 text-rose-900 dark:bg-rose-900/60 dark:text-rose-100",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100",
  green: "bg-green-100 text-green-900 dark:bg-green-900/60 dark:text-green-100",
  orange: "bg-orange-100 text-orange-900 dark:bg-orange-900/60 dark:text-orange-100",
};

export const STAGE_DOT: Record<TagColor, string> = {
  slate: "bg-slate-400",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  rose: "bg-rose-500",
  amber: "bg-amber-500",
  green: "bg-green-600",
  orange: "bg-orange-500",
};

export const TAG_COLOR_LABEL: Record<TagColor, string> = {
  slate: "Cinza",
  teal: "Petróleo",
  blue: "Azul",
  violet: "Violeta",
  rose: "Rosa",
  amber: "Âmbar",
  green: "Verde",
  orange: "Laranja",
};

export function TagChip({ name, color, className }: { name: string; color: TagColor; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-40 items-center truncate rounded px-1.5 py-0.5 text-xs font-medium", TAG_STYLES[color], className)}>
      {name}
    </span>
  );
}

export function StageLabel({ name, color }: { name: string; color: TagColor }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={cn("size-2 shrink-0 rounded-full", STAGE_DOT[color])} aria-hidden="true" />
      {name}
    </span>
  );
}

/**
 * Próxima ação: o único elemento de destaque do sistema.
 * Situação comunicada por cor + ícone + texto (não depende só de cor).
 */
export function NextContactBadge({ at, compact }: { at: string | null; compact?: boolean }) {
  const state = nextContactState(at);
  const map = {
    none: { Icon: CircleDashed, label: "Sem próximo contato", cls: "text-muted-foreground border-border" },
    overdue: { Icon: CalendarX2, label: "Atrasado", cls: "text-danger border-danger/40 bg-danger-soft" },
    today: { Icon: AlarmClock, label: "Hoje", cls: "text-signal border-signal/40 bg-signal-soft" },
    upcoming: { Icon: CalendarClock, label: "Agendado", cls: "text-foreground border-border" },
  }[state];
  const when = at ? (compact ? formatRelative(at) : formatDateTime(at)) : null;
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", map.cls)}
      title={at ? formatDateTime(at) : undefined}
    >
      <map.Icon className="size-3.5" aria-hidden="true" />
      <span suppressHydrationWarning>{state === "none" ? map.label : `${map.label}${when ? ` · ${when}` : ""}`}</span>
    </span>
  );
}
