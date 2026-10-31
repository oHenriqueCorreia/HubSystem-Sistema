import { z } from "zod";

export const taskFormSchema = z
  .object({
    title: z.string().trim().min(1, "Informe o título.").max(200),
    description: z.string().trim().max(10000).optional().nullable(),
    ownerId: z.uuid().nullable().optional(),
    priority: z.enum(["baixa", "media", "alta", "urgente"]).default("media"),
    status: z.enum(["a_fazer", "em_andamento", "concluida", "cancelada"]).default("a_fazer"),
    startDate: z.iso.date().nullable().optional(),
    dueDate: z.iso.date().nullable().optional(),
    dueTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/, "Hora inválida.")
      .nullable()
      .optional(),
    durationMinutes: z.number().int().min(5).max(1440).nullable().optional(),
    category: z.string().trim().max(60).optional().nullable(),
    leadId: z.uuid().nullable().optional(),
    channel: z.enum(["whatsapp", "ligacao", "email", "reuniao", "outro"]).nullable().optional(),
    checklist: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
    tagIds: z.array(z.uuid()).max(20, "Use no máximo 20 etiquetas.").default([]),
    participantIds: z.array(z.uuid()).max(20).default([]),
    columnId: z.uuid().nullable().optional(),
  })
  .refine((v) => !v.dueTime || v.dueDate, { path: ["dueDate"], message: "Informe a data para usar horário." })
  .refine((v) => !v.startDate || !v.dueDate || v.startDate <= v.dueDate, { path: ["startDate"], message: "O início não pode ser depois do prazo." });

export type TaskFormValues = z.input<typeof taskFormSchema>;

export const idSchema = z.object({ id: z.uuid() });
export const taskStatusSchema = z.object({ id: z.uuid(), status: z.enum(["a_fazer", "em_andamento", "concluida", "cancelada"]), outcome: z.string().max(2000).optional() });
export const taskMoveSchema = z.object({ id: z.uuid(), columnId: z.uuid(), position: z.number().finite() });

const COLUMN_COLORS = ["slate", "teal", "blue", "violet", "rose", "amber", "green", "orange"] as const;
export const taskColumnSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(40, "Use no máximo 40 caracteres."),
  color: z.enum(COLUMN_COLORS).default("slate"),
  kind: z.enum(["a_fazer", "em_andamento", "concluida", "cancelada"]),
});
export const taskColumnUpdateSchema = taskColumnSchema.extend({ id: z.uuid() });
export const taskColumnMoveSchema = z.object({ id: z.uuid(), position: z.number().finite() });
export const taskColumnDeleteSchema = z.object({ id: z.uuid(), targetId: z.uuid().nullable().default(null), archiveTasks: z.boolean().default(false) });
export const taskDependencySchema = z.object({ taskId: z.uuid(), dependsOnId: z.uuid() });
export const checklistAddSchema = z.object({ taskId: z.uuid(), title: z.string().trim().min(1, "Escreva o item.").max(200) });
export const checklistToggleSchema = z.object({ id: z.uuid(), done: z.boolean() });
export const commentSchema = z.object({ taskId: z.uuid(), body: z.string().trim().min(1, "Escreva o comentário.").max(5000) });

export const eventFormSchema = z
  .object({
    title: z.string().trim().min(1, "Informe o título.").max(200),
    description: z.string().trim().max(10000).optional().nullable(),
    kind: z.enum(["reuniao", "compromisso", "bloqueio"]).default("reuniao"),
    date: z.iso.date({ error: "Informe a data." }),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida."),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida."),
    allDay: z.boolean().default(false),
    location: z.string().trim().max(300).optional().nullable(),
    meetUrl: z.string().trim().max(500).optional().nullable(),
    ownerId: z.uuid().nullable().optional(),
    leadId: z.uuid().nullable().optional(),
    attendeeIds: z.array(z.uuid()).max(50).default([]),
    guests: z
      .array(
        z.object({
          email: z.email("E-mail inválido.").transform((v) => v.toLowerCase()),
          name: z.string().trim().max(120).default(""),
          optional: z.boolean().default(false),
        }),
      )
      .max(50, "Use no máximo 50 convidados.")
      .default([]),
    sendUpdates: z.boolean().default(true),
    reminderMinutes: z.number().int().min(0).max(10080).nullable().optional(),
  })
  .refine((v) => v.allDay || v.endTime > v.startTime, { path: ["endTime"], message: "O fim precisa ser depois do início." });

export type EventFormValues = z.input<typeof eventFormSchema>;

export const cadenceTemplateSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Informe o nome.").max(80),
  description: z.string().trim().max(500).default(""),
  isActive: z.boolean().default(true),
  steps: z
    .array(
      z.object({
        dayOffset: z.number().int().min(0, "Use 0 ou mais.").max(365),
        timeOfDay: z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida."),
        channel: z.enum(["whatsapp", "ligacao", "email", "reuniao", "outro"]),
        title: z.string().trim().min(2, "Informe o título.").max(120),
        instruction: z.string().trim().max(2000).default(""),
        message: z.string().trim().max(2000).default(""),
      }),
    )
    .min(1, "Adicione pelo menos uma etapa.")
    .max(30),
});

export type CadenceTemplateValues = z.input<typeof cadenceTemplateSchema>;

export const enrollSchema = z.object({ leadId: z.uuid(), templateId: z.uuid(), startDate: z.iso.date().nullable().optional() });

export const availabilitySchema = z.object({ date: z.iso.date(), ownerId: z.uuid().nullable().optional(), minutes: z.number().int().min(15).max(480).default(30) });
