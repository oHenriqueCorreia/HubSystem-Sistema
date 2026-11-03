/** Motivos de encerramento: mantêm os indicadores comparáveis. */
export const OUTCOMES = ["Venda fechada", "Sem interesse", "Preço", "Sem resposta do cliente", "Dúvida resolvida", "Suporte resolvido", "Outro"] as const;

/** Grava "Motivo" ou "Motivo: observação". Os indicadores agrupam pelo motivo. */
export const formatOutcome = (reason: string, note: string) => (note.trim() ? `${reason}: ${note.trim()}` : reason);

export const outcomeReason = (outcome: string | null) => (outcome ? outcome.split(":")[0].trim() : null);
