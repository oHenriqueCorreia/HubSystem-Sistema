// Dinheiro é sempre inteiro em centavos. Nunca somar floats de reais.

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(cents: number | bigint | null | undefined): string {
  if (cents == null) return "";
  return brl.format(Number(cents) / 100);
}

/**
 * Converte texto digitado ("1.234,56", "R$ 10", "10,5") em centavos.
 * Retorna null se não for um valor válido.
 */
export function parseBRL(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input * 100) : null;

  const s = input.replace(/\s|R\$/g, "").trim();
  if (!s) return null;
  if (!/^-?[\d.]*(,\d{0,2})?$/.test(s) && !/^-?\d+(\.\d{1,2})?$/.test(s)) return null;

  // "1234.56" (ponto decimal, sem vírgula e com 1–2 casas) é aceito como decimal.
  const normalized = /^-?\d+\.\d{1,2}$/.test(s) ? s : s.replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Divide um total em N parcelas sem perder centavos (o resto vai para as primeiras). */
export function splitInstallments(totalCents: number, count: number): number[] {
  if (!Number.isInteger(totalCents) || totalCents < 0) throw new RangeError("Total inválido");
  if (!Number.isInteger(count) || count < 1 || count > 360) throw new RangeError("Número de parcelas inválido");
  const base = Math.floor(totalCents / count);
  const rest = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < rest ? 1 : 0));
}
