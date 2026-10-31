export type TaskPriority = "baixa" | "media" | "alta" | "urgente";
export type TaskStatus = "a_fazer" | "em_andamento" | "concluida" | "cancelada";
export type Channel = "whatsapp" | "ligacao" | "email" | "reuniao" | "outro";

export type ChecklistItem = { id: string; title: string; position: number; done_at: string | null };

export type Task = {
  id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  start_date: string | null;
  due_at: string | null;
  has_time: boolean;
  duration_minutes: number | null;
  category: string | null;
  position: number;
  lead_id: string | null;
  deal_id: string | null;
  client_id?: string | null;
  contract_id?: string | null;
  channel: Channel | null;
  suggested_message: string | null;
  outcome: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  cadence_enrollment_id: string | null;
  lead: { id: string; name: string; whatsapp_e164: string | null } | null;
  checklist: ChecklistItem[];
  tags: { id: string; name: string; color: string }[];
};

export type TaskComment = { id: string; author_id: string; body: string; created_at: string };

export const PRIORITY_LABEL: Record<TaskPriority, string> = { baixa: "Baixa", media: "Média", alta: "Alta", urgente: "Urgente" };
export const STATUS_LABEL: Record<TaskStatus, string> = {
  a_fazer: "A fazer",
  em_andamento: "Em andamento",
  concluida: "Concluída",
  cancelada: "Cancelada",
};
export const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  ligacao: "Ligação",
  email: "E-mail",
  reuniao: "Reunião",
  outro: "Outro",
};

export function isOverdue(t: Pick<Task, "due_at" | "status">, now = new Date()): boolean {
  return Boolean(t.due_at) && (t.status === "a_fazer" || t.status === "em_andamento") && new Date(t.due_at!) < now;
}

export function checklistProgress(items: ChecklistItem[]): { done: number; total: number; pct: number } {
  const done = items.filter((i) => i.done_at).length;
  return { done, total: items.length, pct: items.length ? Math.round((done / items.length) * 100) : 0 };
}
