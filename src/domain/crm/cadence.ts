import { zonedDay } from "@/domain/calendar";
import { hourInSaoPaulo } from "@/domain/home";
import { todayLocal } from "@/domain/shared/dates";

export type SendWindow = { start: string; end: string; days: number[] };
export const DEFAULT_SEND_WINDOW: SendWindow = { start: "08:00", end: "20:00", days: [1, 2, 3, 4, 5] };

/** Agora está dentro da janela de envio (horário e dia da semana em São Paulo)? */
export function inSendWindow(w: SendWindow, now = new Date()): boolean {
  const day = zonedDay(todayLocal(now)).getDay();
  const minute = Number(new Intl.DateTimeFormat("pt-BR", { minute: "numeric", timeZone: "America/Sao_Paulo" }).format(now));
  const minutes = hourInSaoPaulo(now) * 60 + minute;
  const [sh, sm] = w.start.split(":").map(Number);
  const [eh, em] = w.end.split(":").map(Number);
  return w.days.includes(day) && minutes >= sh * 60 + sm && minutes < eh * 60 + em;
}
