import { z } from "zod";

export const TRIGGERS = {
  mensagem_recebida: "Chegar uma mensagem",
  conversa_nova: "Começar uma conversa nova",
  conversa_encerrada: "Encerrar um atendimento",
  conversa_esfriou: "O cliente ficar esperando além do limite",
  etapa_alterada: "Um negócio mudar de etapa",
  lead_criado: "Um lead ser criado",
} as const;

export type TriggerKey = keyof typeof TRIGGERS;
export const TRIGGER_KEYS = Object.keys(TRIGGERS) as [TriggerKey, ...TriggerKey[]];

export const conditionSchema = z.object({
  keyword: z.string().trim().max(100).optional(),
  stageId: z.uuid().optional(),
  noAssignee: z.boolean().optional(),
});
export type AutomationCondition = z.infer<typeof conditionSchema>;

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("atribuir"), userId: z.uuid() }),
  z.object({ type: z.literal("etiquetar"), tagId: z.uuid() }),
  z.object({ type: z.literal("enviar_texto"), body: z.string().trim().min(1, "Escreva a mensagem.").max(4096) }),
  z.object({ type: z.literal("criar_tarefa"), title: z.string().trim().min(2, "Dê um título à tarefa.").max(200), dueHours: z.number().int().min(0).max(720) }),
  z.object({ type: z.literal("notificar"), title: z.string().trim().min(2, "Escreva o aviso.").max(200) }),
]);
export type AutomationAction = z.infer<typeof actionSchema>;

export const ACTION_LABELS: Record<AutomationAction["type"], string> = {
  atribuir: "Passar para um responsável",
  etiquetar: "Colocar etiqueta",
  enviar_texto: "Enviar mensagem",
  criar_tarefa: "Criar tarefa",
  notificar: "Avisar os gestores",
};

const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Confere o "se" da automação com o que aconteceu. Sem condição, sempre vale. */
export function matchesCondition(condition: AutomationCondition, event: { body?: string | null; stageId?: string | null; assigneeId?: string | null }) {
  if (condition.keyword && !normalize(event.body ?? "").includes(normalize(condition.keyword))) return false;
  if (condition.stageId && event.stageId !== condition.stageId) return false;
  if (condition.noAssignee && event.assigneeId) return false;
  return true;
}
