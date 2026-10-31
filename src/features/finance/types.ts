import type { FinanceScope, TxnKind, TxnStatus } from "@/domain/finance";
import type { PaymentMethod } from "@/features/clients/types";

export type { FinanceScope, TxnKind, TxnStatus };

export type Account = { id: string; name: string; type: string; opening_balance_cents: number; is_active: boolean };
export type Category = { id: string; name: string; kind: "receita" | "despesa"; is_active: boolean };
export type CostCenter = { id: string; name: string; is_active: boolean };

export type Transaction = {
  id: string;
  scope: FinanceScope;
  kind: TxnKind;
  description: string;
  amount_cents: number;
  paid_amount_cents: number | null;
  category_id: string | null;
  cost_center_id: string | null;
  account_id: string | null;
  transfer_account_id: string | null;
  payment_method: PaymentMethod | null;
  competence_date: string;
  due_date: string;
  paid_at: string | null;
  status: TxnStatus;
  installment_number: number | null;
  installment_total: number | null;
  installment_group_id: string | null;
  recurrence_id: string | null;
  client_id: string | null;
  contract_id: string | null;
  reconciled_at: string | null;
  notes: string | null;
  created_at: string;
  client: { id: string; lead: { name: string } | null } | null;
};

export type Summary = {
  accounts: { id: string; name: string; type: string; balance: number }[];
  balance: number;
  income_paid: number;
  expense_paid: number;
  income_competence: number;
  expense_competence: number;
  receivable_open: number;
  payable_open: number;
  receivable_overdue: number;
  payable_overdue: number;
  overdue_count: number;
};

export const SCOPE_LABEL: Record<FinanceScope, string> = { empresa: "Empresa", pessoal: "Pessoal" };
export const KIND_LABEL: Record<TxnKind, string> = { receita: "Receita", despesa: "Despesa", transferencia: "Transferência" };
export const STATUS_LABEL: Record<TxnStatus, string> = { previsto: "Em aberto", pago: "Pago", cancelado: "Cancelado" };
export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  corrente: "Conta corrente",
  poupanca: "Poupança",
  cartao: "Cartão de crédito",
  dinheiro: "Dinheiro",
  investimento: "Investimento",
  outro: "Outra",
};

export function scopeFromParam(v: string): FinanceScope | null {
  return v === "empresa" || v === "pessoal" ? v : null;
}
