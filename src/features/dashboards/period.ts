import { addMonthsCivil } from "@/domain/finance";
import { todayLocal } from "@/domain/shared/dates";

export type Preset = "hoje" | "7d" | "mes" | "proximo_mes" | "mes_passado" | "90d" | "ano" | "custom";

function monthStart(d: string) {
  return `${d.slice(0, 7)}-01`;
}
function monthEnd(d: string) {
  const [y, m] = d.split("-").map(Number);
  return `${d.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}
function shiftDays(d: string, n: number) {
  return new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Resolve o período dos dashboards a partir da URL. */
export function resolvePeriod(sp: Record<string, string | string[] | undefined>) {
  const today = todayLocal();
  const preset = (typeof sp.periodo === "string" ? sp.periodo : "mes") as Preset;
  let from: string;
  let to: string;
  switch (preset) {
    case "hoje":
      from = today;
      to = today;
      break;
    case "7d":
      from = today;
      to = shiftDays(today, 6);
      break;
    case "proximo_mes": {
      const next = addMonthsCivil(today, 1);
      from = monthStart(next);
      to = monthEnd(next);
      break;
    }
    case "mes_passado": {
      const prev = addMonthsCivil(today, -1);
      from = monthStart(prev);
      to = monthEnd(prev);
      break;
    }
    case "90d":
      from = shiftDays(today, -89);
      to = today;
      break;
    case "ano":
      from = `${today.slice(0, 4)}-01-01`;
      to = `${today.slice(0, 4)}-12-31`;
      break;
    case "custom":
      from = typeof sp.de === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.de) ? sp.de : monthStart(today);
      to = typeof sp.ate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.ate) ? sp.ate : today;
      break;
    default:
      from = monthStart(today);
      to = monthEnd(today);
  }
  // Período anterior de mesma duração (para comparação).
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const prevTo = shiftDays(from, -1);
  const prevFrom = shiftDays(prevTo, -(days - 1));
  return { preset, from, to, prevFrom, prevTo, today };
}

export const PRESETS: [Preset, string][] = [
  ["mes", "Este mês"],
  ["mes_passado", "Mês passado"],
  ["90d", "Últimos 90 dias"],
  ["ano", "Este ano"],
];

/** Financeiro: períodos que olham para frente (o que vence) e para trás (o que foi pago). */
export const FINANCE_PRESETS: [Preset, string][] = [
  ["hoje", "Hoje"],
  ["7d", "Próximos 7 dias"],
  ["mes", "Este mês"],
  ["proximo_mes", "Próximo mês"],
  ["mes_passado", "Mês passado"],
  ["ano", "Este ano"],
];

/** Variação percentual com tratamento para base zero. */
export function delta(current: number, previous: number): { pct: number | null; up: boolean } {
  if (previous === 0) return { pct: current === 0 ? 0 : null, up: current >= 0 };
  return { pct: Math.round(((current - previous) / Math.abs(previous)) * 100), up: current >= previous };
}
