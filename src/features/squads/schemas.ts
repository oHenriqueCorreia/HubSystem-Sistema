import { z } from "zod";

const uuid = z.uuid("Identificador inválido.");

export const squadSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(2, "Informe o nome do squad.").max(60),
  description: z.string().trim().max(300).default(""),
  leaderId: uuid.nullable().default(null),
  memberIds: z.array(uuid).max(200).default([]),
  clientIds: z.array(uuid).max(1000).default([]),
});

export const squadIdSchema = z.object({ id: uuid });

export const clientMemberSchema = z.object({
  clientId: uuid,
  userId: uuid,
  roleLabel: z.string().trim().max(60).default(""),
});

export const removeClientMemberSchema = z.object({ clientId: uuid, userId: uuid });
