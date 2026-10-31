import { z } from "zod";

export const TAG_COLORS = ["slate", "teal", "blue", "violet", "rose", "amber", "green", "orange"] as const;

export const tagSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(40, "Use no máximo 40 caracteres."),
  color: z.enum(TAG_COLORS).default("slate"),
  description: z.string().trim().max(300, "Use no máximo 300 caracteres.").default(""),
});

export const tagUpdateSchema = tagSchema.extend({ id: z.uuid() });
export const tagArchiveSchema = z.object({ id: z.uuid(), archived: z.boolean() });
export const tagIdSchema = z.object({ id: z.uuid() });
