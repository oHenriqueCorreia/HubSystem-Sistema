import { z } from "zod";
import { emailSchema, passwordSchema } from "@/features/auth/schemas";
import { PERMISSION_KEYS } from "@/domain/permissions";

export const uuid = z.uuid("Identificador inválido.");
export const scopeSchema = z.enum(["own", "team", "all"]);

export const inviteSchema = z
  .object({
    email: emailSchema,
    fullName: z.string().trim().min(2, "Informe o nome.").max(120),
    // equipe = entra nesta organização; ambiente = ganha uma organização própria e vazia
    mode: z.enum(["equipe", "ambiente"]).default("equipe"),
    roleId: uuid.nullable().default(null),
    workspaceName: z.string().trim().max(120).default(""),
    overrides: z
      .array(z.object({ key: z.enum(PERMISSION_KEYS), effect: z.enum(["grant", "deny"]), scope: scopeSchema.default("all") }))
      .max(PERMISSION_KEYS.length)
      .default([]),
  })
  .refine((v) => v.mode === "ambiente" || v.roleId, { path: ["roleId"], message: "Escolha o papel." })
  .refine((v) => v.mode === "equipe" || v.workspaceName.length >= 2, { path: ["workspaceName"], message: "Informe o nome da empresa." });

export const invitationIdSchema = z.object({ id: uuid });

export const acceptInvitationSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{40,60}$/, "Convite inválido."),
  fullName: z.string().trim().min(2, "Informe seu nome.").max(120),
  password: passwordSchema,
});

export const setActiveSchema = z.object({ userId: uuid, active: z.boolean() });
export const setRoleSchema = z.object({ userId: uuid, roleId: uuid });

export const overrideSchema = z.object({
  userId: uuid,
  permissionKey: z.enum(PERMISSION_KEYS),
  // null = segue o papel
  effect: z.enum(["grant", "deny"]).nullable(),
  scope: scopeSchema.default("all"),
});

export const rolePermissionSchema = z.object({
  roleId: uuid,
  permissionKey: z.enum(PERMISSION_KEYS),
  // null = sem permissão
  scope: scopeSchema.nullable(),
});

export const createRoleSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do papel.").max(60),
  description: z.string().trim().max(200).default(""),
  copyFrom: uuid.nullable().default(null),
});

export const orgSettingsSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da empresa.").max(120),
  whatsappMessage: z.string().trim().max(500, "Use no máximo 500 caracteres."),
});

export const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Informe seu nome.").max(120),
  jobTitle: z.string().trim().max(80).default(""),
  phone: z.string().trim().max(30).default(""),
});
