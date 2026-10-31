import { splitInstallments } from "@/domain/shared/money";

export type FinanceScope = "empresa" | "pessoal";
export type TxnKind = "receita" | "despesa" | "transferencia";
export type TxnStatus = "previsto" | "pago" | "cancelado";

/** Soma meses a uma data civil mantendo o dia (ajusta para o último dia do mês). */
export function addMonthsCivil(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** Parcelas mensais: valores sem perder centavos e vencimentos mês a mês. */
export function installmentPlan(totalCents: number, count: number, firstDue: string) {
  const amounts = splitInstallments(totalCents, count);
  return amounts.map((amount, i) => ({ number: i + 1, total: count, amount, dueDate: addMonthsCivil(firstDue, i) }));
}

export type FlowTxn = { kind: TxnKind; status: TxnStatus; amount_cents: number; paid_amount_cents: number | null; due_date: string; paid_at: string | null };

/**
 * Fluxo de caixa por dia ou mês: realizado (pago, pela data do pagamento) e
 * previsto (em aberto, pela data de vencimento). Transferências não entram.
 */
export function cashFlow(txns: FlowTxn[], group: "dia" | "mes", openingBalance = 0) {
  const map = new Map<string, { income: number; expense: number; incomeForecast: number; expenseForecast: number }>();
  for (const t of txns) {
    if (t.kind === "transferencia" || t.status === "cancelado") continue;
    const paid = t.status === "pago";
    const date = paid ? (t.paid_at ?? t.due_date) : t.due_date;
    const key = group === "mes" ? date.slice(0, 7) : date;
    const row = map.get(key) ?? { income: 0, expense: 0, incomeForecast: 0, expenseForecast: 0 };
    const value = paid ? (t.paid_amount_cents ?? t.amount_cents) : t.amount_cents;
    if (t.kind === "receita") {
      if (paid) row.income += value;
      else row.incomeForecast += value;
    } else if (paid) row.expense += value;
    else row.expenseForecast += value;
    map.set(key, row);
  }
  let running = openingBalance;
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, r]) => {
      const net = r.income - r.expense + r.incomeForecast - r.expenseForecast;
      running += net;
      return { period, ...r, net, balance: running };
    });
}

export function isOverdueTxn(t: { status: TxnStatus; due_date: string }, today: string): boolean {
  return t.status === "previsto" && t.due_date < today;
}
