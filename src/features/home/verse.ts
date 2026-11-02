import { rotationIndex } from "@/domain/home";
import { MESSAGES, VERSES } from "./content";

export const VERSE_TRANSLATION = "Bíblia Portuguesa Mundial";

/** Os textos ficam no próprio sistema: a passagem não depende de nenhum serviço externo. */
export function verseForSlot(slot: number) {
  return VERSES[rotationIndex(slot, VERSES.length)];
}

export function messageForSlot(slot: number): string {
  // Listas de tamanhos diferentes: passagem e mensagem não formam sempre o mesmo par.
  return MESSAGES[rotationIndex(slot, MESSAGES.length)];
}
