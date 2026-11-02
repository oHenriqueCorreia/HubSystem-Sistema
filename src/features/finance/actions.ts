"use server";

import { revalidatePath } from "next/cache";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { fail, ok } from "@/domain/shared/result";
import { installmentPlan } from "@/domain/finance";
import { upcomingDueDates } from "@/domain/finance/business-days";
import { todayLocal } from "@/domain/shared/dates";
import type { PermissionKey } from "@/domain/permissions";
import {
  accountSchema,
  adminReadSchema,
  categoriesFromTagsSchema,
  categorySchema,
  costCenterSchema,
  idSchema,
  paySchema,
  receivablesSchema,
  recurrenceSchema,
  recurrenceStateSchema,
  reconcileSchema,
  txnFormSchema,
  txnUpdateSchema,
} from "./schemas";
import type { FinanceScope } from "./types";

/** Data do primeiro vencimento de uma conta fixa com dia fixo (dia 31 em mês curto vira o último dia). */
function firstFixedDate(month: string, day: number) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

function revalidateFinance(scope?: FinanceScope) {
  for (const s of scope ? [scope] : (["empresa", "pessoal"] as const)) revalidatePath(`/financeiro/${s}`, "layout");
  revalidatePath("/dashboards", "layout");
}

const perm = (scope: FinanceScope, action: "create" | "update" | "delete" | "reconcile"): PermissionKey =>
  scope === "pessoal" ? "finance.personal.manage" : (`finance.company.${action}` as PermissionKey);

/** Ação condicionada ao contexto do lançamento (pessoal ou empresa). */
async function requireScopePerm(scope: FinanceScope, action: "create" | "update" | "delete" | "reconcile", perms: Record<string, unknown>) {
  return Boolean(perms[perm(scope, action)]);
}

export const createTransaction = defineAction({ schema: txnFormSchema }, async (input, { user }) => {
  if (!(await requireScopePerm(input.scope, "create", user.permissions))) return fail("forbidden", "Você não tem permissão para lançar neste contexto.");
  const supabase = await createClient();

  const base = {
    scope: input.scope,
    kind: input.kind,
    category_id: input.kind === "transferencia" ? "" : (input.categoryId ?? ""),
    cost_center_id: input.costCenterId ?? "",
    account_id: input.accountId ?? "",
    transfer_account_id: input.kind === "transferencia" ? (input.transferAccountId ?? "") : "",
    payment_method: input.paymentMethod ?? "",
    client_id: input.clientId ?? "",
    contract_id: input.contractId ?? "",
    notes: input.notes ?? "",
  };

  if (input.recurrence !== "nenhuma") {
    must(
      await supabase.from("financial_recurrences").insert({
        scope: input.scope,
        owner_user_id: input.scope === "pessoal" ? user.id : null,
        frequency: input.recurrence,
        start_date: input.dueDate,
        end_date: input.recurrenceEnd || null,
        template: { ...base, description: input.description, amount_cents: input.amountCents },
      }),
    );
    must(await supabase.rpc("generate_recurrences", { p_until: null }));
    // A primeira ocorrência pode já ter sido paga.
    if (input.paid && input.paidAt) {
      await supabase
        .from("financial_transactions")
        .update({ status: "pago", paid_at: input.paidAt, paid_amount_cents: input.paidAmountCents ?? input.amountCents })
        .eq("scope", input.scope)
        .eq("description", input.description)
        .eq("due_date", input.dueDate)
        .eq("status", "previsto");
    }
    revalidateFinance(input.scope);
    return ok(null, "Lançamento recorrente criado. As próximas ocorrências já aparecem nas contas a vencer.");
  }

  const groupId = input.installments > 1 ? crypto.randomUUID() : "";
  const plan = installmentPlan(input.amountCents, input.installments, input.dueDate);
  const rows = plan.map((p, i) => ({
    ...base,
    description: input.installments > 1 ? `${input.description} (${p.number}/${p.total})` : input.description,
    amount_cents: p.amount,
    competence_date: input.installments > 1 ? p.dueDate : input.competenceDate,
    due_date: p.dueDate,
    // Só a primeira parcela pode nascer paga.
    status: input.paid && i === 0 ? "pago" : input.kind === "transferencia" ? "pago" : "previsto",
    paid_at: (input.paid && i === 0) || input.kind === "transferencia" ? (input.paidAt ?? input.dueDate) : "",
    installment_group_id: groupId,
    installment_number: input.installments > 1 ? p.number : "",
    installment_total: input.installments > 1 ? p.total : "",
  }));
  must(await supabase.rpc("create_transactions", { p_rows: rows }));
  revalidateFinance(input.scope);
  return ok(null, input.installments > 1 ? `${input.installments} parcelas lançadas.` : "Lançamento salvo.");
});

export const updateTransaction = defineAction({ schema: txnUpdateSchema }, async (input, { user }) => {
  const supabase = await createClient();
  const current = must(await supabase.from("financial_transactions").select("scope, recurrence_id, due_date, installment_group_id").eq("id", input.id).single()) as {
    scope: FinanceScope;
    recurrence_id: string | null;
    due_date: string;
    installment_group_id: string | null;
  };
  if (!(await requireScopePerm(current.scope, "update", user.permissions))) return fail("forbidden", "Você não tem permissão para editar este lançamento.");

  const patch = {
    description: input.description,
    amount_cents: input.amountCents,
    category_id: input.categoryId ?? null,
    account_id: input.accountId ?? null,
    cost_center_id: current.scope === "empresa" ? (input.costCenterId ?? null) : null,
    payment_method: input.paymentMethod ?? null,
    competence_date: input.competenceDate,
    due_date: input.dueDate,
    notes: input.notes || null,
  };
  must(await supabase.from("financial_transactions").update(patch).eq("id", input.id));

  if (input.applyToFuture && current.recurrence_id) {
    const { due_date: _d, competence_date: _c, ...rest } = patch;
    void _d;
    void _c;
    must(
      await supabase
        .from("financial_transactions")
        .update(rest)
        .eq("recurrence_id", current.recurrence_id)
        .eq("status", "previsto")
        .gt("due_date", current.due_date),
    );
    const rec = must(await supabase.from("financial_recurrences").select("template").eq("id", current.recurrence_id).single()) as { template: Record<string, unknown> };
    must(
      await supabase
        .from("financial_recurrences")
        .update({
          template: { ...rec.template, description: rest.description, amount_cents: rest.amount_cents, category_id: rest.category_id ?? "", account_id: rest.account_id ?? "" },
        })
        .eq("id", current.recurrence_id),
    );
  }
  revalidateFinance(current.scope);
  return ok(null, "Lançamento salvo.");
});

export const markPaid = defineAction({ schema: paySchema }, async (input) => {
  const supabase = await createClient();
  const res = must(
    await supabase
      .from("financial_transactions")
      .update({ status: "pago", paid_at: input.paidAt, paid_amount_cents: input.paidAmountCents, ...(input.accountId ? { account_id: input.accountId } : {}) })
      .eq("id", input.id)
      .select("scope, kind"),
  ) as { scope: FinanceScope; kind: string }[];
  if (!res.length) return fail("forbidden", "Você não pode alterar este lançamento.");
  revalidateFinance(res[0].scope);
  return ok(null, res[0].kind === "receita" ? "Recebimento registrado." : "Pagamento registrado.");
});

export const markUnpaid = defineAction({ schema: idSchema }, async ({ id }) => {
  const supabase = await createClient();
  const res = must(await supabase.from("financial_transactions").update({ status: "previsto" }).eq("id", id).select("scope")) as { scope: FinanceScope }[];
  if (!res.length) return fail("forbidden", "Você não pode alterar este lançamento.");
  revalidateFinance(res[0].scope);
  return ok(null, "Lançamento voltou para em aberto.");
});

export const setReconciled = defineAction({ schema: reconcileSchema }, async (input) => {
  const supabase = await createClient();
  const res = must(
    await supabase
      .from("financial_transactions")
      .update({ reconciled_at: input.reconciled ? new Date().toISOString() : null })
      .eq("id", input.id)
      .eq("status", "pago")
      .select("scope"),
  ) as { scope: FinanceScope }[];
  if (!res.length) return fail("business_rule", "Só lançamentos pagos podem ser conciliados.");
  revalidateFinance(res[0].scope);
  return ok(null, input.reconciled ? "Lançamento conciliado." : "Conciliação desfeita.");
});

export const cancelTransaction = defineAction({ schema: idSchema }, async ({ id }) => {
  const supabase = await createClient();
  const res = must(await supabase.from("financial_transactions").update({ status: "cancelado" }).eq("id", id).select("scope")) as { scope: FinanceScope }[];
  if (!res.length) return fail("forbidden", "Você não pode alterar este lançamento.");
  revalidateFinance(res[0].scope);
  return ok(null, "Lançamento cancelado.");
});

export const deleteTransaction = defineAction({ schema: idSchema }, async ({ id }) => {
  const supabase = await createClient();
  const res = must(await supabase.from("financial_transactions").update({ deleted_at: new Date().toISOString() }).eq("id", id).select("scope")) as { scope: FinanceScope }[];
  if (!res.length) return fail("forbidden", "Você não pode excluir este lançamento.");
  revalidateFinance(res[0].scope);
  return ok(null, "Lançamento excluído.");
});

export const restoreTransaction = defineAction({ schema: idSchema }, async ({ id }) => {
  const supabase = await createClient();
  must(await supabase.from("financial_transactions").update({ deleted_at: null }).eq("id", id));
  revalidateFinance();
  return ok(null, "Lançamento restaurado.");
});

export const saveAccount = defineAction({ schema: accountSchema }, async (input, { user }) => {
  if (!(await requireScopePerm(input.scope, input.id ? "update" : "create", user.permissions))) return fail("forbidden", "Sem permissão.");
  const supabase = await createClient();
  const row = { name: input.name, type: input.type, opening_balance_cents: input.openingBalanceCents, is_active: input.isActive };
  if (input.id) must(await supabase.from("financial_accounts").update(row).eq("id", input.id));
  else must(await supabase.from("financial_accounts").insert({ ...row, scope: input.scope, owner_user_id: input.scope === "pessoal" ? user.id : null }));
  revalidateFinance(input.scope);
  return ok(null, "Conta salva.");
});

export const saveCategory = defineAction({ schema: categorySchema }, async (input, { user }) => {
  if (!(await requireScopePerm(input.scope, input.id ? "update" : "create", user.permissions))) return fail("forbidden", "Sem permissão.");
  const supabase = await createClient();
  if (input.parentId && input.parentId === input.id) return fail("validation", "Uma categoria não pode ser subcategoria dela mesma.");
  const row = { name: input.name, kind: input.kind, is_active: input.isActive, parent_id: input.parentId };
  if (input.id) {
    must(await supabase.from("financial_categories").update(row).eq("id", input.id));
    revalidateFinance(input.scope);
    return ok({ id: input.id }, "Categoria salva.");
  }
  const created = must(
    await supabase
      .from("financial_categories")
      .insert({ ...row, scope: input.scope, owner_user_id: input.scope === "pessoal" ? user.id : null })
      .select("id")
      .single(),
  ) as { id: string };
  revalidateFinance(input.scope);
  return ok({ id: created.id }, "Categoria criada.");
});

export const saveCostCenter = defineAction({ schema: costCenterSchema, permission: "finance.company.update" }, async (input) => {
  const supabase = await createClient();
  const row = { name: input.name, is_active: input.isActive };
  if (input.id) must(await supabase.from("cost_centers").update(row).eq("id", input.id));
  else must(await supabase.from("cost_centers").insert(row));
  revalidateFinance("empresa");
  return ok(null, "Centro de custo salvo.");
});

export const generateReceivables = defineAction({ schema: receivablesSchema, permission: "finance.company.create" }, async (input) => {
  const supabase = await createClient();
  const count = must(await supabase.rpc("contract_to_receivables", { p_contract: input.contractId, p_account: input.accountId, p_category: input.categoryId })) as number;
  revalidateFinance("empresa");
  revalidatePath(`/contratos/${input.contractId}`);
  return ok(null, count ? `${count} cobrança(s) prevista(s) gerada(s) no financeiro.` : "As cobranças deste contrato já existem.");
});

export const adminReadPersonal = defineAction({ schema: adminReadSchema, permission: "finance.personal.admin_read" }, async (input) => {
  const supabase = await createClient();
  const data = must(await supabase.rpc("admin_read_personal_finance", { p_user: input.userId, p_from: input.from, p_to: input.to })) as {
    transactions: { id: string; kind: string; description: string; amount_cents: number; status: string; due_date: string; paid_at: string | null; category: string | null; account: string | null }[];
  };
  return ok(data);
});

const RECURRENCE_MESSAGE = {
  ativa: "Recorrência retomada. As próximas ocorrências foram geradas.",
  pausada: "Recorrência pausada. As ocorrências futuras previstas foram para a lixeira.",
  encerrada: "Recorrência encerrada. O histórico foi mantido.",
} as const;

/** Pausa, retoma ou encerra uma série sem alterar ocorrências passadas ou pagas. */
export const setRecurrenceState = defineAction({ schema: recurrenceStateSchema }, async (input) => {
  const supabase = await createClient();
  must(await supabase.rpc("set_recurrence_state", { p_id: input.id, p_state: input.state }));
  if (input.state === "ativa") must(await supabase.rpc("generate_recurrences", { p_until: null }));
  revalidateFinance();
  return ok(null, RECURRENCE_MESSAGE[input.state]);
});

/** Conta fixa (ex.: mensalidade no 5º dia útil). Gera as ocorrências dos próximos 12 meses. */
export const createRecurrence = defineAction({ schema: recurrenceSchema }, async (input, { user }) => {
  if (!(await requireScopePerm(input.scope, "create", user.permissions))) return fail("forbidden", "Você não tem permissão para lançar neste contexto.");
  const supabase = await createClient();
  const businessDay = input.dueRule === "dia_util";
  // Vencimentos que já passaram não são criados: a série começa no próximo a partir de hoje.
  const first = upcomingDueDates({ startMonth: input.startMonth, frequency: input.frequency, rule: input.dueRule, day: businessDay ? input.businessDay : input.dueDay, count: 16 }).find(
    (d) => d >= todayLocal(),
  );
  if (!first) return fail("validation", "Não há vencimento futuro com essas datas.", { startMonth: ["Escolha um mês a partir de agora."] });
  must(
    await supabase.from("financial_recurrences").insert({
      scope: input.scope,
      owner_user_id: input.scope === "pessoal" ? user.id : null,
      frequency: input.frequency,
      // Dia útil: a série começa no 1º dia do mês do primeiro vencimento; dia fixo: a data define o dia de todos os meses.
      start_date: businessDay ? `${first.slice(0, 7)}-01` : firstFixedDate(first.slice(0, 7), input.dueDay),
      end_date: input.endDate,
      due_rule: input.dueRule,
      business_day: businessDay ? input.businessDay : null,
      template: { kind: input.kind, description: input.description, amount_cents: input.amountCents, category_id: input.categoryId ?? "", account_id: input.accountId ?? "" },
    }),
  );
  must(await supabase.rpc("generate_recurrences", { p_until: null }));
  revalidateFinance(input.scope);
  revalidatePath("/inicio");
  return ok(null, "Recorrência criada. As próximas datas já aparecem em Lançamentos, nos painéis e no Início.");
});

/** Cria tipos (categorias) a partir das etiquetas do sistema. Nomes já existentes são ignorados. */
export const createCategoriesFromTags = defineAction({ schema: categoriesFromTagsSchema }, async (input, { user }) => {
  if (!(await requireScopePerm(input.scope, "create", user.permissions))) return fail("forbidden", "Sem permissão.");
  const supabase = await createClient();
  const { data: existing } = await supabase.from("financial_categories").select("name").eq("scope", input.scope).eq("kind", input.kind);
  const taken = new Set(((existing ?? []) as { name: string }[]).map((c) => c.name.toLowerCase()));
  const fresh = [...new Set(input.names)].filter((n) => !taken.has(n.toLowerCase()));
  if (fresh.length)
    must(
      await supabase
        .from("financial_categories")
        .insert(fresh.map((name) => ({ name, kind: input.kind, scope: input.scope, owner_user_id: input.scope === "pessoal" ? user.id : null }))),
    );
  revalidateFinance(input.scope);
  return ok(null, fresh.length ? `${fresh.length} tipo(s) criado(s).` : "Esses tipos já existiam.");
});
