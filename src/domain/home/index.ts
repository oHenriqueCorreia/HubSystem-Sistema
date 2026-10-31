import { APP_TIMEZONE } from "@/domain/shared/dates";

/** Hora (0–23) no fuso de São Paulo. */
export function hourInSaoPaulo(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hourCycle: "h23", timeZone: APP_TIMEZONE }).format(now));
}

export type DayPeriod = "madrugada" | "manha" | "tarde" | "noite";

export function dayPeriod(hour: number): DayPeriod {
  if (hour < 5) return "madrugada";
  if (hour < 12) return "manha";
  if (hour < 18) return "tarde";
  return "noite";
}

export function greetingFor(hour: number): string {
  const p = dayPeriod(hour);
  return p === "manha" ? "Bom dia" : p === "tarde" ? "Boa tarde" : "Boa noite";
}

/** Dias desde 01/01/1970 para uma data civil "YYYY-MM-DD". */
function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/**
 * Índice do item do dia: o mesmo o dia todo e sem repetir até percorrer a
 * lista inteira (passo coprimo com o tamanho espalha os itens vizinhos).
 */
export function dailyIndex(day: string, length: number): number {
  if (length <= 0) return 0;
  let step = Math.max(1, Math.floor(length * 0.618));
  while (gcd(step, length) !== 1) step++;
  const n = dayNumber(day);
  return (((n * step) % length) + length) % length;
}

// Códigos WMO usados pela Open-Meteo.
const WMO: [number[], string, WeatherIcon][] = [
  [[0], "Céu limpo", "sol"],
  [[1], "Predomínio de sol", "sol-nuvem"],
  [[2], "Parcialmente nublado", "sol-nuvem"],
  [[3], "Nublado", "nuvem"],
  [[45, 48], "Nevoeiro", "nevoa"],
  [[51, 53, 55, 56, 57], "Garoa", "chuva"],
  [[61, 63, 66, 80, 81], "Chuva", "chuva"],
  [[65, 67, 82], "Chuva forte", "chuva"],
  [[71, 73, 75, 77, 85, 86], "Neve", "neve"],
  [[95, 96, 99], "Tempestade", "tempestade"],
];

export type WeatherIcon = "sol" | "sol-nuvem" | "nuvem" | "nevoa" | "chuva" | "neve" | "tempestade";

export function weatherLabel(code: number): { label: string; icon: WeatherIcon } {
  const hit = WMO.find(([codes]) => codes.includes(code));
  return hit ? { label: hit[1], icon: hit[2] } : { label: "Condição indisponível", icon: "nuvem" };
}

export const DEFAULT_CITY = { name: "Araranguá, SC", latitude: -28.9356, longitude: -49.4918 };
export type City = typeof DEFAULT_CITY;
