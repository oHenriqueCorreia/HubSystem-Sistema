import type { AgendaEntry, AgendaPriority, AgendaType } from "./agenda";

/** Cores disponíveis: a paleta de gráficos do sistema, já conferida nos temas claro e escuro. */
export const SWATCHES = {
  vermelho: "var(--slice-8)",
  laranja: "var(--slice-2)",
  amarelo: "var(--slice-4)",
  verde: "var(--slice-3)",
  azul: "var(--slice-1)",
  roxo: "var(--slice-7)",
  rosa: "var(--slice-5)",
  cinza: "var(--muted-foreground)",
} as const;
export type Swatch = keyof typeof SWATCHES;
export const SWATCH_LABEL: Record<Swatch, string> = { vermelho: "Vermelho", laranja: "Laranja", amarelo: "Amarelo", verde: "Verde", azul: "Azul", roxo: "Roxo", rosa: "Rosa", cinza: "Cinza" };

export const PRIORITIES: AgendaPriority[] = ["urgente", "alta", "media", "baixa"];
export const PRIORITY_LABEL: Record<AgendaPriority, string> = { urgente: "Urgente", alta: "Alta", media: "Média", baixa: "Baixa" };

export type AgendaPrefs = {
  /** Tipo mantém a cor de cada tipo, com a faixa da prioridade; prioridade pinta o item todo. */
  colorBy: "tipo" | "prioridade";
  density: "confortavel" | "compacta";
  weekends: boolean;
  defaultTab: "hoje" | "semana" | "mes" | null;
  hiddenTypes: AgendaType[];
  priorityColors: Record<AgendaPriority, Swatch>;
};

export const DEFAULT_AGENDA_PREFS: AgendaPrefs = {
  colorBy: "tipo",
  density: "confortavel",
  weekends: true,
  defaultTab: null,
  hiddenTypes: [],
  priorityColors: { urgente: "vermelho", alta: "laranja", media: "azul", baixa: "cinza" },
};

const TYPES: AgendaType[] = ["reuniao", "compromisso", "bloqueio", "tarefa", "prazo", "publicacao"];

/** Preferência salva pode ser antiga ou incompleta: o que não for reconhecido volta ao padrão. */
export function parseAgendaPrefs(raw: unknown): AgendaPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof AgendaPrefs, unknown>>;
  const d = DEFAULT_AGENDA_PREFS;
  const colors = (r.priorityColors && typeof r.priorityColors === "object" ? r.priorityColors : {}) as Record<string, unknown>;
  return {
    colorBy: r.colorBy === "prioridade" ? "prioridade" : d.colorBy,
    density: r.density === "compacta" ? "compacta" : d.density,
    weekends: r.weekends === false ? false : d.weekends,
    defaultTab: r.defaultTab === "hoje" || r.defaultTab === "semana" || r.defaultTab === "mes" ? r.defaultTab : null,
    hiddenTypes: Array.isArray(r.hiddenTypes) ? (r.hiddenTypes as AgendaType[]).filter((t) => TYPES.includes(t)) : [],
    priorityColors: Object.fromEntries(PRIORITIES.map((p) => [p, typeof colors[p] === "string" && colors[p] in SWATCHES ? colors[p] : d.priorityColors[p]])) as Record<AgendaPriority, Swatch>,
  };
}

export const priorityColor = (priority: AgendaEntry["priority"], prefs: AgendaPrefs) => (priority ? SWATCHES[prefs.priorityColors[priority]] : null);

/** Só o que merece atenção aparece escrito na cor por tipo; pintando por prioridade, todas aparecem. */
export const showsPriorityTag = (priority: AgendaEntry["priority"], prefs: AgendaPrefs) => Boolean(priority && (prefs.colorBy === "prioridade" || priority === "alta" || priority === "urgente"));

/** Sábado e domingo, numa data civil (AAAA-MM-DD). */
export const isWeekend = (day: string) => {
  const w = new Date(`${day}T12:00:00Z`).getUTCDay();
  return w === 0 || w === 6;
};

export const visibleDays = (days: string[], prefs: AgendaPrefs) => (prefs.weekends ? days : days.filter((d) => !isWeekend(d)));
