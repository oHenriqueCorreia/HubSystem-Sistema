// Leitura de arquivos de texto (CSV, extratos) e reparo de acentuação corrompida.
// Espelha private.fix_mojibake_1252 no banco: a mesma regra nos dois lados.

// Bytes 0x80–0x9F do Windows-1252 que viram outro caractere ao decodificar.
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89,
  0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Byte que o caractere representava no Windows-1252/Latin-1, ou null. */
function cp1252Byte(ch: string): number | null {
  const code = ch.codePointAt(0)!;
  if (code <= 0xff) return code;
  return CP1252[code] ?? null;
}

// Caractere de continuação: o que um byte 0x80–0xBF vira no Windows-1252/Latin-1.
const CONT = `[\\u0080-\\u00bf${Object.keys(CP1252)
  .map((c) => `\\u${Number(c).toString(16).padStart(4, "0")}`)
  .join("")}]`;
// Sequência UTF-8 completa lida como Windows-1252: 1º byte + 1, 2 ou 3 continuações.
const MOJIBAKE = new RegExp(`[\\u00c2-\\u00df]${CONT}|[\\u00e0-\\u00ef]${CONT}{2}|[\\u00f0-\\u00f4]${CONT}{3}`, "g");

/** Há sinal de texto UTF-8 lido como Windows-1252 (ex.: "â€œ", "Ã§")? */
export function hasMojibake(text: string): boolean {
  MOJIBAKE.lastIndex = 0;
  return MOJIBAKE.test(text);
}

/**
 * Desfaz "â€œ" → "“", "Ã§" → "ç", "Ãšltima" → "Última". Só troca sequências que
 * formam UTF-8 válido; texto correto (inclusive "SÃO", "NÃO", "1º") não muda.
 */
export function repairMojibake(text: string): string {
  if (!hasMojibake(text)) return text;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return text.replace(MOJIBAKE, (seq) => {
    const bytes = [...seq].map(cp1252Byte);
    if (bytes.some((b) => b === null)) return seq;
    try {
      return decoder.decode(new Uint8Array(bytes as number[]));
    } catch {
      return seq;
    }
  });
}

/**
 * Texto de um arquivo enviado: UTF-8 (com ou sem BOM) ou, se não for UTF-8 válido,
 * Windows-1252 (Excel antigo, ISO-8859-1). Arquivo que já chega com a acentuação
 * corrompida (exportado errado de outro sistema) é reparado.
 */
export function decodeTextFile(buffer: ArrayBuffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder("windows-1252").decode(buffer);
  }
  return repairMojibake(text.replace(/^﻿/, ""));
}
