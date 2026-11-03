import { z } from "zod";

/** Preferências de lembretes (profiles.preferences.notificacoes, lidas por private.generate_reminders). */
export const notificationPrefsSchema = z.object({
  tarefas: z.boolean(),
  agenda: z.boolean(),
  financeiro: z.boolean(),
  comercial: z.boolean(),
  task_minutes: z.number().int().min(5).max(1440),
  event_minutes: z.number().int().min(5).max(1440),
  bill_days: z.number().int().min(0).max(30),
});

export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { tarefas: true, agenda: true, financeiro: true, comercial: true, task_minutes: 60, event_minutes: 30, bill_days: 2 };
