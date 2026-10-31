import { TZDate } from "@date-fns/tz";
import { format, formatDistanceToNowStrict, isValid, parse } from "date-fns";
import { ptBR } from "date-fns/locale";

export const APP_TIMEZONE = "America/Sao_Paulo";

/** Instante (timestamptz) → data/hora no fuso de São Paulo. */
export function toLocal(value: string | Date | number): TZDate {
  return new TZDate(new Date(value).getTime(), APP_TIMEZONE);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  // Datas civis (YYYY-MM-DD) não têm fuso: não converter, senão "volta" um dia.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }
  return format(toLocal(value), "dd/MM/yyyy", { locale: ptBR });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  return format(toLocal(value), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
}

export function formatRelative(value: string | Date): string {
  return formatDistanceToNowStrict(new Date(value), { locale: ptBR, addSuffix: true });
}

/** "31/12/2026" → "2026-12-31" (data civil). Retorna null se inválida. */
export function parseBrDate(input: string): string | null {
  const d = parse(input.trim(), "dd/MM/yyyy", new Date());
  if (!isValid(d) || d.getFullYear() < 1900 || d.getFullYear() > 2200) return null;
  return format(d, "yyyy-MM-dd");
}

/** Hoje (data civil) em São Paulo, no formato YYYY-MM-DD. */
export function todayLocal(now: Date = new Date()): string {
  return format(new TZDate(now.getTime(), APP_TIMEZONE), "yyyy-MM-dd");
}
