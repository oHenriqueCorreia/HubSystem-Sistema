import "server-only";
import { dailyIndex } from "@/domain/home";
import { MESSAGES, VERSES } from "./content";

export type DailyVerse = { reference: string; text: string | null; translation: string };

/** Passagem do dia: a mesma para todos durante o dia; texto com cache de 1 dia. */
export async function getDailyVerse(day: string): Promise<DailyVerse> {
  const v = VERSES[dailyIndex(day, VERSES.length)];
  try {
    const res = await fetch(`https://bible-api.com/${encodeURIComponent(v.api)}?translation=almeida`, {
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const d = (await res.json()) as { text?: string };
    const text = d.text?.replace(/\s+/g, " ").trim() || null;
    return { reference: v.ref, text, translation: "Almeida (domínio público)" };
  } catch {
    // Sem a API, mostramos ao menos a referência para leitura.
    return { reference: v.ref, text: null, translation: "Almeida (domínio público)" };
  }
}

export function dailyMessage(day: string): string {
  // Desloca o índice para não coincidir com o ciclo das passagens.
  return MESSAGES[(dailyIndex(day, MESSAGES.length) + 7) % MESSAGES.length];
}
