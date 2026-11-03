import { z } from "zod";
import { isValidDocument } from "@/domain/shared/document";
import { normalizePhone } from "@/domain/shared/phone";

export const contractFormSchema = z
  .object({
    title: z.string().trim().min(2, "Informe o título.").max(160),
    serviceId: z.uuid().nullable().optional(),
    description: z.string().trim().max(10000).optional().nullable(),
    amountCents: z.number({ error: "Informe o valor." }).int().min(0, "Valor inválido.").max(10_000_000_000),
    paymentMethod: z.enum(["pix", "boleto", "cartao_credito", "cartao_debito", "transferencia", "dinheiro", "outro"]),
    recurrence: z.enum(["unica", "mensal", "trimestral", "semestral", "anual"]),
    startDate: z.iso.date({ error: "Informe a data de início." }),
    endDate: z.iso.date().nullable().optional(),
    dueDay: z.number().int().min(1, "Use um dia entre 1 e 31.").max(31, "Use um dia entre 1 e 31.").nullable().optional(),
    status: z.enum(["rascunho", "ativo", "pausado", "encerrado", "cancelado"]).default("ativo"),
    ownerId: z.uuid().nullable().optional(),
    notes: z.string().trim().max(10000).optional().nullable(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { path: ["endDate"], message: "O término precisa ser depois do início." });

export type ContractFormValues = z.input<typeof contractFormSchema>;

export const convertSchema = z.object({
  leadId: z.uuid(),
  dealId: z.uuid().nullable(),
  legalName: z.string().trim().max(200).default(""),
  document: z
    .string()
    .trim()
    .default("")
    .refine((v) => !v || isValidDocument(v), "CPF ou CNPJ inválido."),
  billingEmail: z
    .string()
    .trim()
    .default("")
    .refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "E-mail inválido."),
  billingPhone: z
    .string()
    .trim()
    .default("")
    .refine((v) => !v || normalizePhone(v) !== null, "Telefone inválido."),
  contract: contractFormSchema.nullable(),
});

export const clientUpdateSchema = convertSchema.pick({ legalName: true, document: true, billingEmail: true, billingPhone: true }).extend({
  id: z.uuid(),
  status: z.enum(["ativo", "inativo"]),
  notes: z.string().trim().max(10000).default(""),
});

/** Cliente do novo contrato: um cliente existente, um lead do CRM ou um cliente novo. */
const contractClientSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("cliente"), clientId: z.uuid({ error: "Escolha o cliente." }) }),
  z.object({ mode: z.literal("lead"), leadId: z.uuid({ error: "Escolha o lead." }) }),
  z.object({
    mode: z.literal("novo"),
    name: z.string().trim().min(2, "Informe o nome do cliente.").max(160),
    document: z
      .string()
      .trim()
      .default("")
      .refine((v) => !v || isValidDocument(v), "CPF ou CNPJ inválido."),
    email: z
      .string()
      .trim()
      .default("")
      .refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "E-mail inválido."),
    phone: z
      .string()
      .trim()
      .default("")
      .refine((v) => !v || normalizePhone(v) !== null, "Telefone inválido."),
  }),
]);

/** Contrato com cliente, já lançado no financeiro da empresa. */
export const newContractSchema = z.object({
  client: contractClientSchema,
  contract: contractFormSchema,
  finance: z.object({
    launch: z.boolean(),
    accountId: z.uuid().nullable(),
    categoryId: z.uuid().nullable(),
    // Cobranças com vencimento antes de hoje (contrato que já estava rodando).
    past: z.enum(["ignorar", "recebidas", "abertas"]).default("ignorar"),
  }),
});
export type NewContractValues = z.input<typeof newContractSchema>;

export const attachmentEntitySchema = z.object({
  entityType: z.enum(["lead", "client", "contract", "task", "transaction"]),
  entityId: z.uuid(),
});

export const uploadRequestSchema = attachmentEntitySchema.extend({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().max(120),
  size: z.number().int().positive(),
});
