import { dayKey } from "@/domain/calendar";

/** Cor fixa por contato: o mesmo nome sempre tem a mesma cor de avatar. */
export const AVATAR_COLORS = ["#00a884", "#027eb5", "#7f66ff", "#d3396d", "#e26b00", "#0a8f6c", "#5e5ce6", "#b4531f"];

export function avatarColor(seed: string) {
  let hash = 0;
  for (const c of seed) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function chatInitials(name: string) {
  const words = name.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (!words.length) return "";
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

const TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

export const chatTime = (iso: string) => TIME.format(new Date(iso));

const addDay = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Separador de dia dentro da conversa. */
export function dayLabel(iso: string, today: string) {
  const day = dayKey(iso);
  if (day === today) return "Hoje";
  if (day === addDay(today, -1)) return "Ontem";
  const date = new Date(`${day}T12:00:00Z`);
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" }).format(date);
}

/** Horário na lista: hoje mostra a hora, ontem o nome, antes a data. */
export function listTime(iso: string, today: string) {
  const day = dayKey(iso);
  if (day === today) return chatTime(iso);
  if (day === addDay(today, -1)) return "Ontem";
  return `${day.slice(8, 10)}/${day.slice(5, 7)}${day.slice(0, 4) === today.slice(0, 4) ? "" : `/${day.slice(2, 4)}`}`;
}

const TYPE_LABEL: Record<string, string> = { image: "Foto", video: "Vídeo", audio: "Áudio", document: "Documento", sticker: "Figurinha", location: "Localização", contacts: "Contato", template: "Modelo" };

/** Texto curto da última mensagem, ou o tipo da mídia quando não há texto. */
export function messagePreview(m: { type: string; body: string | null; media_name?: string | null } | null | undefined) {
  if (!m) return "";
  const text = m.body?.trim();
  if (text) return text.replace(/\s+/g, " ");
  if (m.type === "document" && m.media_name) return m.media_name;
  return TYPE_LABEL[m.type] ?? "Mensagem";
}

export type DayGroup<T> = { day: string; label: string; items: T[] };

/** Agrupa em ordem, no dia de São Paulo. */
export function groupMessagesByDay<T extends { created_at: string }>(messages: T[], today: string): DayGroup<T>[] {
  const out: DayGroup<T>[] = [];
  for (const m of messages) {
    const day = dayKey(m.created_at);
    const last = out[out.length - 1];
    if (last?.day === day) last.items.push(m);
    else out.push({ day, label: dayLabel(m.created_at, today), items: [m] });
  }
  return out;
}

/** Id de citação no formato do WAHA. */
export const wahaReplyId = (fromMe: boolean, chatId: string, wamid: string) => `${fromMe ? "true" : "false"}_${chatId}_${wamid}`;

export const EMOJIS = ["😀", "😂", "🥰", "😍", "😉", "😊", "🙂", "🤔", "😅", "😎", "🤩", "😢", "😭", "😡", "🙏", "👍", "👎", "👏", "🤝", "💪", "👋", "✌️", "👌", "❤️", "💙", "💚", "🔥", "✨", "🎉", "🚀", "✅", "❌", "⚠️", "📌", "📅", "⏰", "💰", "💵", "🏠", "🚗", "📞", "📷", "📄", "🔗"];
