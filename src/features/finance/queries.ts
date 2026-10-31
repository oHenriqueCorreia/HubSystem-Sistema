import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Account, Category, CostCenter, FinanceScope, Summary, Transaction } from "./types";

type Row = Record<string, unknown>;

export async function prepareScope(scope: FinanceScope) {
  const supabase = await createClient();
  if (scope === "pessoal") await supabase.rpc("ensure_personal_defaults");
  // Materializa recorrências (idempotente) para fluxo de caixa e "a vencer".
  await supabase.rpc("generate_recurrences", { p_until: null });
}

export const getLookups = cache(async (scope: FinanceScope) => {
  const supabase = await createClient();
  const [accounts, categories, centers] = await Promise.all([
    supabase.from("financial_accounts").select("id, name, type, opening_balance_cents, is_active").eq("scope", scope).order("name"),
    supabase.from("financial_categories").select("id, name, kind, is_active").eq("scope", scope).order("name"),
    scope === "empresa" ? supabase.from("cost_centers").select("id, name, is_active").order("name") : Promise.resolve({ data: [] as CostCenter[], error: null }),
  ]);
  if (accounts.error) throw accounts.error;
  return {
    accounts: (accounts.data ?? []) as Account[],
    categories: (categories.data ?? []) as Category[],
    costCenters: (centers.data ?? []) as CostCenter[],
  };
});

export async function getSummary(scope: FinanceScope, from: string, to: string): Promise<Summary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_summary", { p_scope: scope, p_from: from, p_to: to });
  if (error) throw error;
  return data as Summary;
}

export type TxnFilters = {
  tipo?: "receita" | "despesa" | "transferencia";
  situacao?: "abertos" | "vencidos" | "pagos" | "a_receber" | "a_pagar" | "nao_conciliados";
  de?: string;
  ate?: string;
  categoria?: string;
  conta?: string;
  centro?: string;
  q?: string;
  data?: "vencimento" | "competencia" | "pagamento";
  pagina?: number;
};

const TXN_COLUMNS = `id, scope, kind, description, amount_cents, paid_amount_cents, category_id, cost_center_id, account_id, transfer_account_id,
  payment_method, competence_date, due_date, paid_at, status, installment_number, installment_total, installment_group_id, recurrence_id,
  client_id, contract_id, reconciled_at, notes, created_at, client:clients(id, lead:leads(name))`;

export const TXN_PAGE = 100;

export async function listTransactions(scope: FinanceScope, f: TxnFilters, today: string) {
  const supabase = await createClient();
  const dateCol = f.data === "competencia" ? "competence_date" : f.data === "pagamento" ? "paid_at" : "due_date";
  let q = supabase.from("financial_transactions").select(TXN_COLUMNS, { count: "exact" }).eq("scope", scope).is("deleted_at", null);
  if (f.tipo) q = q.eq("kind", f.tipo);
  if (f.situacao === "abertos") q = q.eq("status", "previsto");
  if (f.situacao === "pagos") q = q.eq("status", "pago");
  if (f.situacao === "vencidos") q = q.eq("status", "previsto").lt("due_date", today);
  if (f.situacao === "a_receber") q = q.eq("status", "previsto").eq("kind", "receita");
  if (f.situacao === "a_pagar") q = q.eq("status", "previsto").eq("kind", "despesa");
  if (f.situacao === "nao_conciliados") q = q.eq("status", "pago").is("reconciled_at", null);
  if (f.de) q = q.gte(dateCol, f.de);
  if (f.ate) q = q.lte(dateCol, f.ate);
  if (f.categoria) q = q.eq("category_id", f.categoria);
  if (f.conta) q = q.or(`account_id.eq.${f.conta},transfer_account_id.eq.${f.conta}`);
  if (f.centro) q = q.eq("cost_center_id", f.centro);
  if (f.q) q = q.ilike("description", `%${f.q.replace(/[%_\\,()]/g, (c) => `\\${c}`)}%`);
  const page = Math.max(1, f.pagina ?? 1);
  const from = (page - 1) * TXN_PAGE;
  const { data, error, count } = await q
    .order(dateCol, { ascending: f.situacao === "pagos" ? false : true, nullsFirst: false })
    .order("created_at")
    .range(from, from + TXN_PAGE - 1);
  if (error) throw error;
  return {
    rows: ((data ?? []) as Row[]).map((r) => {
      const c = (Array.isArray(r.client) ? r.client[0] : r.client) as Row | null;
      const lead = c ? ((Array.isArray(c.lead) ? c.lead[0] : c.lead) as { name: string } | null) : null;
      return { ...(r as unknown as Transaction), client: c ? { id: c.id as string, lead } : null };
    }),
    total: count ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / TXN_PAGE)),
  };
}

/** Lançamentos para fluxo de caixa e gráficos (campos mínimos). */
export async function listFlow(scope: FinanceScope, from: string, to: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("financial_transactions")
    .select("kind, status, amount_cents, paid_amount_cents, due_date, paid_at, competence_date, category_id")
    .eq("scope", scope)
    .is("deleted_at", null)
    .neq("status", "cancelado")
    .or(`and(status.eq.pago,paid_at.gte.${from},paid_at.lte.${to}),and(status.eq.previsto,due_date.gte.${from},due_date.lte.${to})`)
    .limit(10000);
  if (error) throw error;
  return (data ?? []) as {
    kind: "receita" | "despesa" | "transferencia";
    status: "previsto" | "pago" | "cancelado";
    amount_cents: number;
    paid_amount_cents: number | null;
    due_date: string;
    paid_at: string | null;
    competence_date: string;
    category_id: string | null;
  }[];
}

export async function listContractsForFinance() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("contracts")
    .select("id, title, amount_cents, recurrence, status, client:clients(id, lead:leads(name))")
    .is("deleted_at", null)
    .eq("status", "ativo")
    .order("title")
    .limit(500);
  return ((data ?? []) as Row[]).map((k) => {
    const c = (Array.isArray(k.client) ? k.client[0] : k.client) as Row | null;
    const lead = c ? ((Array.isArray(c.lead) ? c.lead[0] : c.lead) as { name: string } | null) : null;
    return { id: k.id as string, title: k.title as string, clientId: (c?.id as string) ?? null, clientName: lead?.name ?? "" };
  });
}

export async function getContractReceivables(contractId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("financial_transactions")
    .select("id, description, amount_cents, due_date, status, paid_at")
    .eq("contract_id", contractId)
    .is("deleted_at", null)
    .order("due_date")
    .limit(60);
  return (data ?? []) as { id: string; description: string; amount_cents: number; due_date: string; status: string; paid_at: string | null }[];
}
