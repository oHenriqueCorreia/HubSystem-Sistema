/** Valor em centavos na moeda da conta de anúncio (BRL por padrão). */
export function formatMoney(cents: number, currency = "BRL") {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
  } catch {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
  }
}

export const formatPct = (v: number | null) => (v === null ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);
export const formatInt = (v: number) => Math.round(v).toLocaleString("pt-BR");

/** ROAS: quanto voltou em valor de conversão para cada 1 investido. */
export const formatRoas = (value: number, spend: number) =>
  spend > 0 && value > 0 ? `${(value / spend).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x` : "—";
