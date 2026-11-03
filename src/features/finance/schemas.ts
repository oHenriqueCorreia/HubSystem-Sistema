import { z } from "zod";

const scope = z.enum(["empresa", "pessoal"]);

export const txnFormSchema = z
  .object({
    scope,
    kind: z.enum(["receita", "despesa", "transferencia"]),
    description: z.string().trim().min(1, "Informe a descrição.").max(200),
    amountCents: z.number({ error: "Informe o valor." }).int().positive("O valor precisa ser maior que zero.").max(100_000_000_000),
    categoryId: z.uuid().nullable().optional(),
    accountId: z.uuid({ error: "Escolha a conta." }).nullable().optional(),
    transferAccountId: z.uuid().nullable().optional(),
    costCenterId: z.uuid().nullable().optional(),
    paymentMethod: z.enum(["pix", "boleto", "cartao_credito", "cartao_debito", "transferencia", "dinheiro", "outro"]).nullable().optional(),
    competenceDate: z.iso.date({ error: "Informe a competência." }),
    dueDate: z.iso.date({ error: "Informe o vencimento." }),
    paid: z.boolean().default(false),
    paidAt: z.iso.date().nullable().optional(),
    paidAmountCents: z.number().int().min(0).nullable().optional(),
    installments: z.number().int().min(1).max(120).default(1),
    recurrence: z.enum(["nenhuma", "semanal", "mensal", "trimestral", "semestral", "anual"]).default("nenhuma"),
    recurrenceEnd: z.iso.date().nullable().optional(),
    clientId: z.uuid().nullable().optional(),
    contractId: z.uuid().nullable().optional(),
    notes: z.string().trim().max(5000).optional().nullable(),
    counterparty: z.string().trim().max(160).optional().nullable(),
    chargeReason: z.enum(["mensalidade", "boleto", "servico", "outro"]).nullable().optional(),
    chargeNote: z.string().trim().max(200).optional().nullable(),
  })
  .refine((v) => v.kind !== "transferencia" || (v.accountId && v.transferAccountId && v.accountId !== v.transferAccountId), {
    path: ["transferAccountId"],
    message: "Escolha contas de origem e destino diferentes.",
  })
  .refine((v) => !v.paid || v.paidAt, { path: ["paidAt"], message: "Informe a data do pagamento." })
  .refine((v) => v.installments === 1 || v.recurrence === "nenhuma", { path: ["recurrence"], message: "Use parcelamento ou recorrência, não os dois." })
  .refine((v) => v.scope === "empresa" || (!v.clientId && !v.contractId && !v.costCenterId), { path: ["clientId"], message: "Cliente, contrato e centro de custo são só da empresa." });

export type TxnFormValues = z.input<typeof txnFormSchema>;

export const txnUpdateSchema = z.object({
  id: z.uuid(),
  description: z.string().trim().min(1, "Informe a descrição.").max(200),
  amountCents: z.number().int().positive("O valor precisa ser maior que zero."),
  categoryId: z.uuid().nullable().optional(),
  accountId: z.uuid().nullable().optional(),
  costCenterId: z.uuid().nullable().optional(),
  paymentMethod: z.enum(["pix", "boleto", "cartao_credito", "cartao_debito", "transferencia", "dinheiro", "outro"]).nullable().optional(),
  competenceDate: z.iso.date(),
  dueDate: z.iso.date(),
  notes: z.string().trim().max(5000).optional().nullable(),
  counterparty: z.string().trim().max(160).optional().nullable(),
  chargeReason: z.enum(["mensalidade", "boleto", "servico", "outro"]).nullable().optional(),
  chargeNote: z.string().trim().max(200).optional().nullable(),
  applyToFuture: z.boolean().default(false),
});

export const paySchema = z.object({
  id: z.uuid(),
  paidAt: z.iso.date({ error: "Informe a data." }),
  paidAmountCents: z.number().int().min(0),
  accountId: z.uuid().nullable().optional(),
});

export const idSchema = z.object({ id: z.uuid() });
export const reconcileSchema = z.object({ id: z.uuid(), reconciled: z.boolean() });

export const accountSchema = z.object({
  id: z.uuid().optional(),
  scope,
  name: z.string().trim().min(2, "Informe o nome.").max(80),
  type: z.enum(["corrente", "poupanca", "cartao", "dinheiro", "investimento", "outro"]),
  openingBalanceCents: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const categorySchema = z.object({
  id: z.uuid().optional(),
  scope,
  name: z.string().trim().min(2, "Informe o nome.").max(80),
  kind: z.enum(["receita", "despesa"]),
  // Subcategoria: aponta para a categoria "mãe" do mesmo tipo.
  parentId: z.uuid().nullable().default(null),
  isActive: z.boolean().default(true),
});

export const recurrenceStateSchema = z.object({ id: z.uuid(), state: z.enum(["ativa", "pausada", "encerrada"]) });

/** Conta fixa: dia do mês ou N-ésimo dia útil, a partir de um mês. */
export const recurrenceSchema = z
  .object({
    scope,
    kind: z.enum(["despesa", "receita"]),
    description: z.string().trim().min(1, "Informe a descrição.").max(200),
    amountCents: z.number().int().positive("Informe o valor."),
    categoryId: z.uuid().nullable().default(null),
    accountId: z.uuid().nullable().default(null),
    frequency: z.enum(["mensal", "trimestral", "semestral", "anual"]),
    dueRule: z.enum(["dia_fixo", "dia_util"]),
    dueDay: z.number().int().min(1, "Dia de 1 a 31.").max(31, "Dia de 1 a 31.").default(10),
    businessDay: z.number().int().min(1, "De 1 a 23.").max(23, "De 1 a 23.").default(5),
    startMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Escolha o mês do primeiro vencimento."),
    endDate: z.iso.date().nullable().default(null),
  })
  .refine((v) => !v.endDate || v.endDate >= `${v.startMonth}-01`, { path: ["endDate"], message: "O término precisa ser depois do início." });
export type RecurrenceValues = z.input<typeof recurrenceSchema>;

export const categoriesFromTagsSchema = z.object({ scope, kind: z.enum(["receita", "despesa"]), names: z.array(z.string().trim().min(2).max(40)).min(1, "Escolha ao menos uma etiqueta.").max(50) });

export const costCenterSchema = z.object({ id: z.uuid().optional(), name: z.string().trim().min(2, "Informe o nome.").max(80), isActive: z.boolean().default(true) });

export const receivablesSchema = z.object({ contractId: z.uuid(), accountId: z.uuid().nullable(), categoryId: z.uuid().nullable() });

export const adminReadSchema = z.object({ userId: z.uuid(), from: z.iso.date(), to: z.iso.date() });
