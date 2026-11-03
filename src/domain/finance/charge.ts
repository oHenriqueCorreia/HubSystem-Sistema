import { formatBRL } from "@/domain/shared/money";

export const CHARGE_REASON_LABEL: Record<string, string> = { mensalidade: "Mensalidade", boleto: "Boleto", servico: "Serviço", outro: "Outro" };
export const PIX_KEY_TYPE_LABEL: Record<string, string> = { cnpj: "CNPJ", cpf: "CPF", email: "E-mail", telefone: "Telefone", aleatoria: "Chave aleatória" };

export type PaymentProfile = { pix_key: string; pix_key_type: string; holder_name: string; bank_name: string | null; instructions: string | null };

const brDate = (iso: string) => iso.split("-").reverse().join("/");

/** Texto inicial da cobrança. A pessoa revisa e edita antes de enviar. */
export function buildChargeMessage(input: { name: string; description: string; reason: string | null; note: string | null; amountCents: number; dueDate: string; profile: PaymentProfile | null }) {
  const first = input.name.trim().split(/\s+/)[0] ?? "";
  const reason = [input.reason ? CHARGE_REASON_LABEL[input.reason] : null, input.note].filter(Boolean).join(": ");
  const payment = input.profile
    ? [`Pix (${PIX_KEY_TYPE_LABEL[input.profile.pix_key_type] ?? "chave"}): ${input.profile.pix_key}`, `Favorecido: ${input.profile.holder_name}`, input.profile.bank_name ? `Banco: ${input.profile.bank_name}` : null, input.profile.instructions].filter(Boolean)
    : [];
  return [
    `Olá${first ? ` ${first}` : ""}! Segue a cobrança:`,
    "",
    `Motivo: ${reason || input.description}`,
    ...(reason ? [`Referente a: ${input.description}`] : []),
    `Valor: ${formatBRL(input.amountCents)}`,
    `Vencimento: ${brDate(input.dueDate)}`,
    ...(payment.length ? ["", ...payment] : []),
    "",
    "Depois do pagamento, é só enviar o comprovante por aqui.",
  ].join("\n");
}

export type DashboardRow = { kind: string; status: string; amount_cents: number; paid_amount_cents: number | null; due_date: string; paid_at: string | null; category_id: string | null };
export type CategorySlice = { id: string; name: string; value: number; percent: number };

const effective = (t: DashboardRow) => t.paid_amount_cents ?? t.amount_cents;

/** Fatias por categoria: as maiores e o restante em "Outras", para continuar legível. */
export function categorySlices(rows: DashboardRow[], kind: "receita" | "despesa", state: "pago" | "previsto", names: Map<string, string>, max = 7): CategorySlice[] {
  const totals = new Map<string, number>();
  for (const t of rows) {
    if (t.kind !== kind || t.status !== state) continue;
    const key = t.category_id ?? "__sem__";
    totals.set(key, (totals.get(key) ?? 0) + (state === "pago" ? effective(t) : t.amount_cents));
  }
  const sum = [...totals.values()].reduce((a, b) => a + b, 0);
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, max);
  const rest = sorted.slice(max).reduce((a, [, v]) => a + v, 0);
  const slice = (id: string, name: string, value: number) => ({ id, name, value, percent: sum ? (value / sum) * 100 : 0 });
  return [...top.map(([id, value]) => slice(id, id === "__sem__" ? "Sem categoria" : (names.get(id) ?? "Categoria"), value)), ...(rest ? [slice("__outras__", "Outras", rest)] : [])];
}

/** Evolução por mês: efetivo pela data do pagamento, pendente pelo vencimento. */
export function monthlyEvolution(rows: DashboardRow[]) {
  const months = new Map<string, { mes: string; entradas: number; saidas: number; entradasPendentes: number; saidasPendentes: number }>();
  const at = (key: string) => {
    if (!months.has(key)) months.set(key, { mes: key, entradas: 0, saidas: 0, entradasPendentes: 0, saidasPendentes: 0 });
    return months.get(key)!;
  };
  for (const t of rows) {
    if (t.kind !== "receita" && t.kind !== "despesa") continue;
    if (t.status === "pago" && t.paid_at) {
      const m = at(t.paid_at.slice(0, 7));
      if (t.kind === "receita") m.entradas += effective(t);
      else m.saidas += effective(t);
    } else if (t.status === "previsto") {
      const m = at(t.due_date.slice(0, 7));
      if (t.kind === "receita") m.entradasPendentes += t.amount_cents;
      else m.saidasPendentes += t.amount_cents;
    }
  }
  return [...months.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}
