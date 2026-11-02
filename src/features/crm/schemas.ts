import { z } from "zod";
import { UFS } from "@/domain/crm/import";
import { normalizePhone } from "@/domain/shared/phone";

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use no máximo ${max} caracteres.`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const phoneField = z
  .string()
  .trim()
  .max(30)
  .optional()
  .nullable()
  .refine((v) => !v || normalizePhone(v) !== null, "Telefone inválido. Inclua o DDD, ex.: (11) 99999-0000.");

export const leadFormSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(160),
  company_name: optText(160),
  phone: phoneField,
  whatsapp: phoneField,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .nullable()
    .refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "E-mail inválido."),
  website: optText(300),
  instagram: optText(300),
  facebook: optText(300),
  linkedin: optText(300),
  address: optText(300),
  neighborhood: optText(120),
  city: optText(120),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .nullable()
    .refine((v) => !v || (UFS as readonly string[]).includes(v), "UF inválida."),
  zip: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((v) => !v || /^\d{5}-?\d{3}$/.test(v), "CEP inválido. Use 00000-000."),
  gmb_url: optText(2000),
  category: optText(120),
  segment_id: z.uuid().nullable().optional(),
  source: optText(80),
  owner_id: z.uuid().nullable().optional(),
  services_interest: z.array(z.string().max(60)).max(20).default([]),
  notes: optText(10000),
});

export type LeadFormValues = z.input<typeof leadFormSchema>;

export const idSchema = z.object({ id: z.uuid() });

export const activitySchema = z.object({
  leadId: z.uuid(),
  dealId: z.uuid().nullable().optional(),
  type: z.enum(["nota", "whatsapp", "ligacao", "email", "reuniao"]),
  content: z.string().trim().min(1, "Escreva o que aconteceu.").max(10000),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});

export const nextContactSchema = z.object({
  leadId: z.uuid(),
  at: z.iso.datetime({ offset: true }).nullable(),
});

export const moveDealSchema = z.object({
  dealId: z.uuid(),
  stageId: z.uuid(),
  position: z.number().finite(),
  lostReasonId: z.uuid().nullable().optional(),
  lostNote: z.string().trim().max(1000).nullable().optional(),
});

export const assignSchema = z.object({ leadId: z.uuid(), ownerId: z.uuid().nullable() });
export const bulkAssignSchema = z.object({ leadIds: z.array(z.uuid()).min(1).max(500), ownerId: z.uuid().nullable() });

export const tagSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(40),
  color: z.enum(["slate", "teal", "blue", "violet", "rose", "amber", "green", "orange"]).default("slate"),
});

export const leadTagsSchema = z.object({ leadId: z.uuid(), tagIds: z.array(z.uuid()).max(30) });

export const dealValueSchema = z.object({
  dealId: z.uuid(),
  amountCents: z.number().int().min(0).max(10_000_000_000).nullable(),
  billing: z.enum(["unico", "mensal"]).nullable(),
  expectedCloseDate: z.iso.date().nullable(),
});

export const importRowSchema = z.object({
  _line: z.number().int(),
  name: z.string().min(1).max(160),
  company_name: z.string().max(160).nullable(),
  phone_raw: z.string().max(40).nullable(),
  phone_e164: z.string().regex(/^\+[1-9]\d{7,14}$/).nullable(),
  phone_type: z.enum(["celular", "fixo", "desconhecido"]).nullable(),
  whatsapp_e164: z.string().regex(/^\+[1-9]\d{7,14}$/).nullable(),
  email: z.string().max(200).nullable(),
  website: z.string().max(300).nullable(),
  instagram: z.string().max(300).nullable(),
  facebook: z.string().max(300).nullable(),
  linkedin: z.string().max(300).nullable(),
  address: z.string().max(300).nullable(),
  neighborhood: z.string().max(120).nullable(),
  city: z.string().max(120).nullable(),
  state: z.string().length(2).nullable(),
  zip: z.string().max(9).nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  place_id: z.string().max(200).nullable(),
  gmb_url: z.string().max(2000).nullable(),
  gmb_rating: z.number().min(0).max(5).nullable(),
  gmb_reviews_count: z.number().int().min(0).nullable(),
  notes: z.string().max(10000).nullable(),
  category: z.string().max(120).nullable(),
  source: z.string().max(80).nullable().optional(),
});

export const importSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  pipelineId: z.uuid(),
  mode: z.enum(["skip", "update"]),
  segmentName: z.string().trim().max(80).nullable(),
  rows: z.array(importRowSchema).min(1, "Nenhuma linha válida para importar.").max(10000),
});

export const checkExistingSchema = z.object({
  placeIds: z.array(z.string().max(200)).max(10000),
  phones: z.array(z.string().max(20)).max(10000),
  emails: z.array(z.string().max(200)).max(10000),
});

export const saveMappingSchema = z.object({
  signature: z.string().max(4000),
  mapping: z.record(z.string(), z.string().max(200)),
});
