"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SendBlocked, sendAutomated } from "@/lib/inbox-send";
import { fail, ok } from "@/domain/shared/result";
import { brPhoneVariants, normalizePhone } from "@/domain/shared/phone";
import { buildChargeMessage, type PaymentProfile } from "@/domain/finance/charge";
import { canRepeatMonthly } from "@/domain/finance/bulk";
import { likelyDuplicate, matchCandidates, suggestRule, type CategoryRule, type MatchTxn } from "@/domain/finance/statement";
import type { CurrentUser } from "@/lib/auth/dal";
import { getLookups, prepareScope } from "./queries";
import type { FinanceScope } from "./types";

const scopeEnum = z.enum(["empresa", "pessoal"]);

function refresh() {
  for (const s of ["empresa", "pessoal"] as const) revalidatePath(`/financeiro/${s}`, "layout");
  revalidatePath("/dashboards", "layout");
  revalidatePath("/inicio");
}

const canUse = (user: CurrentUser, scope: FinanceScope, action: "read" | "create" | "update") => Boolean(user.permissions[scope === "pessoal" ? "finance.personal.manage" : (`finance.company.${action}` as const)]);

// --- Transferência entre áreas -----------------------------------------------------

export const getTransferOptions = defineAction({ schema: z.object({ to: scopeEnum }) }, async ({ to }, { user }) => {
  if (!canUse(user, to, "create")) return fail("forbidden", "Você não tem acesso à área de destino.");
  await prepareScope(to);
  const lookups = await getLookups(to);
  return ok({ accounts: lookups.accounts.filter((a) => a.is_active), categories: lookups.categories.filter((c) => c.is_active) });
});

export const transferTransaction = defineAction({ schema: z.object({ id: z.uuid(), categoryId: z.uuid().nullable(), accountId: z.uuid().nullable(), recurring: z.boolean().default(false) }) }, async (input) => {
  const supabase = await createClient();
  const to = must(await supabase.rpc(input.recurring ? "transfer_personal_to_company_recurring" : "transfer_transaction_scope", { p_id: input.id, p_category: input.categoryId, p_account: input.accountId })) as FinanceScope;
  refresh();
  return ok({ to }, input.recurring ? "Receita transferida para a empresa e recorrência mensal criada." : `Lançamento transferido para ${to === "empresa" ? "a empresa" : "o pessoal"}. Saldos e gráficos das duas áreas foram atualizados.`);
});

// Mensagens escritas pelas regras do banco já explicam o motivo; o resto vira uma frase genérica.
const reasonOf = (error: { code?: string; message?: string }) => (["P0001", "P0002", "42501"].includes(error.code ?? "") && error.message ? error.message : "Não foi possível mover este lançamento.");

const bulkIds = z.array(z.uuid()).min(1, "Selecione ao menos um lançamento.").max(100, "Selecione até 100 lançamentos por vez.");

/** Corrige vários lançamentos na área errada. Cada um é independente: um problema não trava os outros. */
export const bulkTransferTransactions = defineAction(
  { schema: z.object({ ids: bulkIds, revenueCategoryId: z.uuid().nullable(), expenseCategoryId: z.uuid().nullable(), accountId: z.uuid().nullable(), recurring: z.boolean().default(false) }) },
  async (input) => {
    const supabase = await createClient();
    const rows = must(await supabase.from("financial_transactions").select("id, kind, status, description, contract_id, recurrence_id, installment_group_id, scope").in("id", input.ids).is("deleted_at", null)) as { id: string; kind: string; status: string; description: string; contract_id: string | null; recurrence_id: string | null; installment_group_id: string | null; scope: FinanceScope }[];
    const failed: { description: string; reason: string }[] = [];
    let moved = 0;
    let repeating = 0;
    for (const t of rows) {
      const repeat = input.recurring && t.scope === "pessoal" && canRepeatMonthly(t);
      const { error } = await supabase.rpc(repeat ? "transfer_personal_to_company_recurring" : "transfer_transaction_scope", { p_id: t.id, p_category: t.kind === "receita" ? input.revenueCategoryId : input.expenseCategoryId, p_account: input.accountId });
      if (error) {
        failed.push({ description: t.description, reason: reasonOf(error) });
        continue;
      }
      moved++;
      if (repeat) repeating++;
    }
    if (moved) refresh();
    const words = [`${moved} ${moved === 1 ? "lançamento movido" : "lançamentos movidos"}`];
    if (repeating) words.push(`${repeating} ${repeating === 1 ? "virou receita recorrente" : "viraram receitas recorrentes"}`);
    return ok({ moved, failed }, `${words.join(", ")}.`);
  },
);

export const bulkDeleteTransactions = defineAction({ schema: z.object({ ids: bulkIds }) }, async ({ ids }) => {
  const supabase = await createClient();
  const res = must(await supabase.from("financial_transactions").update({ deleted_at: new Date().toISOString() }).in("id", ids).is("deleted_at", null).select("id")) as { id: string }[];
  if (!res.length) return fail("forbidden", "Você não pode excluir estes lançamentos.");
  refresh();
  const skipped = ids.length - res.length;
  return ok({ deleted: res.map((r) => r.id) }, `${res.length} ${res.length === 1 ? "lançamento excluído" : "lançamentos excluídos"}.${skipped ? ` ${skipped} sem permissão para excluir.` : ""}`);
});

export const bulkRestoreTransactions = defineAction({ schema: z.object({ ids: bulkIds }) }, async ({ ids }) => {
  const supabase = await createClient();
  must(await supabase.from("financial_transactions").update({ deleted_at: null }).in("id", ids));
  refresh();
  return ok(null, "Lançamentos restaurados.");
});

export const getTxnHistory = defineAction({ schema: z.object({ id: z.uuid() }) }, async ({ id }) => {
  const supabase = await createClient();
  const [events, transfers, charges] = await Promise.all([
    supabase.from("financial_txn_events").select("id, action, changes, actor_id, created_at").eq("txn_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("financial_scope_transfers").select("id, from_scope, to_scope, previous_category, previous_account, previous_client, previous_cost_center, moved_by, moved_at").eq("txn_id", id).order("moved_at", { ascending: false }),
    supabase.from("charge_messages").select("id, phone, body, status, error, sent_by, created_at").eq("txn_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  const people = [...new Set([...(events.data ?? []).map((e) => e.actor_id), ...(transfers.data ?? []).map((t) => t.moved_by), ...(charges.data ?? []).map((c) => c.sent_by)].filter(Boolean))] as string[];
  const { data: profiles } = people.length ? await supabase.from("profiles").select("id, full_name, email").in("id", people) : { data: [] };
  return ok({
    events: (events.data ?? []) as { id: number; action: string; changes: Record<string, { de: unknown; para: unknown }>; actor_id: string | null; created_at: string }[],
    transfers: (transfers.data ?? []) as { id: string; from_scope: string; to_scope: string; previous_category: string | null; previous_account: string | null; previous_client: string | null; previous_cost_center: string | null; moved_by: string | null; moved_at: string }[],
    charges: (charges.data ?? []) as { id: string; phone: string; body: string; status: string; error: string | null; sent_by: string | null; created_at: string }[],
    names: Object.fromEntries((profiles ?? []).map((p) => [p.id, (p.full_name as string) || (p.email as string)])) as Record<string, string>,
  });
});

// --- Dados de recebimento ----------------------------------------------------------

export const savePaymentProfile = defineAction(
  {
    schema: z.object({
      scope: scopeEnum,
      pixKey: z.string().trim().min(1, "Informe a chave Pix.").max(140),
      pixKeyType: z.enum(["cnpj", "cpf", "email", "telefone", "aleatoria"]),
      holderName: z.string().trim().min(1, "Informe o nome do favorecido.").max(160),
      bankName: z.string().trim().max(80).default(""),
      instructions: z.string().trim().max(500).default(""),
    }),
  },
  async (input, { user }) => {
    if (!canUse(user, input.scope, "update")) return fail("forbidden", "Você não pode alterar estes dados.");
    const supabase = await createClient();
    const row = { scope: input.scope, owner_user_id: input.scope === "pessoal" ? user.id : null, pix_key: input.pixKey, pix_key_type: input.pixKeyType, holder_name: input.holderName, bank_name: input.bankName || null, instructions: input.instructions || null, updated_at: new Date().toISOString() };
    let q = supabase.from("payment_profiles").select("id").eq("scope", input.scope);
    if (input.scope === "pessoal") q = q.eq("owner_user_id", user.id);
    const { data: current } = await q.maybeSingle();
    must(current ? await supabase.from("payment_profiles").update(row).eq("id", current.id) : await supabase.from("payment_profiles").insert(row));
    revalidatePath(`/financeiro/${input.scope}/cadastros`);
    return ok(null, "Dados de recebimento salvos.");
  },
);

// --- Cobrança por WhatsApp ---------------------------------------------------------

async function chargeContext(id: string, user: CurrentUser) {
  const supabase = await createClient();
  const { data: t } = await supabase
    .from("financial_transactions")
    .select("id, scope, kind, status, description, amount_cents, due_date, counterparty, charge_reason, charge_note, client:clients(id, legal_name, lead:leads(id, name, whatsapp_e164, phone_e164))")
    .eq("id", id)
    .maybeSingle();
  if (!t) return null;
  // Cada cobrança usa os dados de recebimento da própria área.
  let q = supabase.from("payment_profiles").select("pix_key, pix_key_type, holder_name, bank_name, instructions").eq("scope", t.scope);
  if (t.scope === "pessoal") q = q.eq("owner_user_id", user.id);
  const { data: profile } = await q.maybeSingle();
  const client = (Array.isArray(t.client) ? t.client[0] : t.client) as { id: string; legal_name: string | null; lead: unknown } | null;
  const lead = (client ? (Array.isArray(client.lead) ? client.lead[0] : client.lead) : null) as { id: string; name: string; whatsapp_e164: string | null; phone_e164: string | null } | null;
  // Telefone de cobrança só com clients.billing (a função devolve vazio sem a permissão).
  const billing = client ? ((await supabase.rpc("client_billing", { p_ids: [client.id] })).data as { billing_phone_e164: string | null }[] | null)?.[0] : null;
  return { t, profile: profile as PaymentProfile | null, name: client?.legal_name || lead?.name || (t.counterparty as string | null) || "", phone: billing?.billing_phone_e164 ?? lead?.whatsapp_e164 ?? lead?.phone_e164 ?? "", leadId: lead?.id ?? null };
}

export const prepareCharge = defineAction({ schema: z.object({ id: z.uuid() }) }, async ({ id }, { user }) => {
  const ctx = await chargeContext(id, user);
  if (!ctx) return fail("not_found", "Lançamento não encontrado.");
  if (ctx.t.kind !== "receita") return fail("business_rule", "Só receitas podem ser cobradas.");
  const { count } = await createAdminClient().from("whatsapp_numbers").select("id", { count: "exact", head: true }).eq("organization_id", user.organizationId).eq("status", "ativo");
  return ok({
    name: ctx.name,
    phone: ctx.phone,
    hasProfile: Boolean(ctx.profile),
    whatsappReady: Boolean(count),
    message: buildChargeMessage({ name: ctx.name, description: ctx.t.description as string, reason: ctx.t.charge_reason as string | null, note: ctx.t.charge_note as string | null, amountCents: Number(ctx.t.amount_cents), dueDate: ctx.t.due_date as string, profile: ctx.profile }),
  });
});

/** O envio é pedido pela pessoa depois de revisar. Quem pediu para sair continua bloqueado. */
export const sendCharge = defineAction({ schema: z.object({ id: z.uuid(), phone: z.string().trim().min(8, "Informe o telefone.").max(40), body: z.string().trim().min(1, "Escreva a mensagem.").max(4000) }) }, async (input, { user }) => {
  const ctx = await chargeContext(input.id, user);
  if (!ctx) return fail("not_found", "Lançamento não encontrado.");
  if (!canUse(user, ctx.t.scope as FinanceScope, "update")) return fail("forbidden", "Você não pode cobrar este lançamento.");
  const phone = normalizePhone(input.phone)?.e164;
  if (!phone) return fail("validation", "Telefone inválido.");
  const admin = createAdminClient();
  const supabase = await createClient();
  const record = (status: "enviada" | "erro", error: string | null) => supabase.from("charge_messages").insert({ txn_id: input.id, phone, body: input.body, status, error });

  const variants = brPhoneVariants(phone);
  const { data: number } = await admin.from("whatsapp_numbers").select("id").eq("organization_id", user.organizationId).eq("status", "ativo").order("created_at").limit(1).maybeSingle();
  if (!number) {
    await record("erro", "Nenhum WhatsApp conectado.");
    return fail("business_rule", "Nenhum WhatsApp conectado. Conecte um número em Atendimento ou abra a conversa pelo link.");
  }
  const leadId = ctx.leadId ?? ((await admin.from("leads").select("id").eq("organization_id", user.organizationId).is("deleted_at", null).or(variants.map((v) => `whatsapp_e164.eq.${v},phone_e164.eq.${v}`).join(",")).limit(1).maybeSingle()).data?.id as string | undefined) ?? null;
  try {
    await sendAutomated({ organizationId: user.organizationId, numberId: number.id as string, phone, leadId, contactName: ctx.name, clientRef: crypto.randomUUID(), body: input.body, requireConsent: false });
  } catch (e) {
    const message = e instanceof SendBlocked ? e.message : ((e as { detail?: string }).detail ?? "O WhatsApp recusou o envio.");
    await record("erro", message.slice(0, 500));
    return fail("business_rule", `Não enviado: ${message}`);
  }
  await record("enviada", null);
  revalidatePath("/atendimento");
  return ok(null, "Cobrança enviada pelo WhatsApp.");
});

// --- Extrato bancário --------------------------------------------------------------

const analyzeSchema = z.object({
  hashes: z.array(z.string().max(400)).max(3000),
  lines: z.array(z.object({ id: z.string().max(20), date: z.iso.date().nullable(), amountCents: z.number().int().nonnegative(), direction: z.enum(["entrada", "saida"]), description: z.string().max(300) })).max(3000),
});

/** Só lê: aponta duplicatas, cobranças para conciliar e sugestões de categoria. */
export const analyzeStatement = defineAction({ schema: analyzeSchema }, async ({ hashes, lines }, { user }) => {
  const supabase = await createClient();
  const dates = lines.map((l) => l.date).filter(Boolean) as string[];
  const from = dates.length ? new Date(Date.parse(`${dates.reduce((a, b) => (a < b ? a : b))}T12:00:00Z`) - 8 * 86_400_000).toISOString().slice(0, 10) : "2000-01-01";
  const to = dates.length ? new Date(Date.parse(`${dates.reduce((a, b) => (a > b ? a : b))}T12:00:00Z`) + 8 * 86_400_000).toISOString().slice(0, 10) : "2100-01-01";
  const [imported, txns, rules] = await Promise.all([
    hashes.length ? supabase.from("statement_lines").select("line_hash").in("line_hash", hashes.slice(0, 3000)).neq("action", "ignorado") : Promise.resolve({ data: [] }),
    // A RLS entrega só o que a pessoa pode ver: empresa com permissão e o próprio pessoal.
    supabase.from("financial_transactions").select("id, scope, kind, description, amount_cents, paid_amount_cents, due_date, paid_at, status, reconciled_at").is("deleted_at", null).in("kind", ["receita", "despesa"]).neq("status", "cancelado").or(`and(due_date.gte.${from},due_date.lte.${to}),and(paid_at.gte.${from},paid_at.lte.${to})`).limit(5000),
    supabase.from("categorization_rules").select("pattern, category_id, scope"),
  ]);
  const known = new Set((imported.data ?? []).map((l) => l.line_hash as string));
  const all = (txns.data ?? []) as MatchTxn[];
  const list = (rules.data ?? []) as CategoryRule[];
  void user;
  return ok({
    importedHashes: [...known],
    lines: lines.map((l) => ({
      id: l.id,
      duplicate: likelyDuplicate(l, all),
      candidates: matchCandidates(l, all).slice(0, 5).map((t) => ({ id: t.id, scope: t.scope, description: t.description, amount_cents: t.amount_cents, due_date: t.due_date, status: t.status })),
      rule: suggestRule(l.description, list),
    })),
  });
});

const commitSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  format: z.enum(["pdf", "ofx", "csv", "planilha"]),
  rows: z
    .array(
      z.object({
        action: z.enum(["criar", "conciliar", "ignorar"]),
        date: z.iso.date({ error: "Há linhas sem data." }),
        description: z.string().trim().min(1, "Há linhas sem descrição.").max(300),
        amount_cents: z.number({ error: "Há linhas sem valor." }).int().positive("Há linhas sem valor."),
        direction: z.enum(["entrada", "saida"]),
        hash: z.string().max(400),
        scope: scopeEnum.optional(),
        category_id: z.uuid().nullable().optional(),
        account_id: z.uuid().nullable().optional(),
        txn_id: z.uuid().optional(),
      }),
    )
    .min(1, "Nenhuma linha para gravar.")
    .max(3000),
});

export const commitStatement = defineAction({ schema: commitSchema }, async (input, { user }) => {
  for (const r of input.rows) {
    if (r.action === "criar" && (!r.scope || !canUse(user, r.scope, "create"))) return fail("forbidden", "Você não pode lançar em uma das áreas escolhidas.");
    if (r.action === "criar" && !r.account_id) return fail("validation", "Escolha a conta das linhas que serão criadas.");
    if (r.action === "conciliar" && !r.txn_id) return fail("validation", "Há linha para conciliar sem lançamento escolhido.");
  }
  const supabase = await createClient();
  const result = must(await supabase.rpc("commit_statement", { p_file: input.fileName, p_format: input.format, p_rows: input.rows })) as { criados: number; conciliados: number; ignorados: number };
  refresh();
  return ok(result, `${result.criados} lançamento(s) criado(s), ${result.conciliados} conciliado(s) e ${result.ignorados} ignorado(s).`);
});

export const saveCategoryRule = defineAction({ schema: z.object({ scope: scopeEnum, pattern: z.string().trim().min(2, "Use ao menos 2 letras.").max(80), categoryId: z.uuid("Escolha a categoria.") }) }, async (input, { user }) => {
  if (!canUse(user, input.scope, "update")) return fail("forbidden", "Você não pode criar regras nesta área.");
  const supabase = await createClient();
  const { error } = await supabase.from("categorization_rules").insert({ scope: input.scope, owner_user_id: input.scope === "pessoal" ? user.id : null, pattern: input.pattern, category_id: input.categoryId });
  if (error?.code === "23505") return fail("conflict", "Já existe uma regra com este texto.");
  if (error) throw error;
  return ok(null, "Regra salva. Ela vira sugestão nas próximas importações.");
});
