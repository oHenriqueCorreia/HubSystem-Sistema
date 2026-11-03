type Row = { kind: string; status: string; contract_id: string | null; recurrence_id: string | null; installment_group_id: string | null };

/** Por que um lançamento não pode mudar de área. As mesmas regras valem no banco. */
export function bulkTransferBlock(t: Pick<Row, "kind" | "contract_id" | "recurrence_id">): string | null {
  if (t.kind === "transferencia") return "transferência entre contas não muda de área";
  if (t.contract_id) return "vem de um contrato, altere o contrato";
  if (t.recurrence_id) return "vem de uma recorrência, encerre a recorrência";
  return null;
}

/** Só receita avulsa e ativa vira recorrência: parcela já tem as próximas e cancelada não se repete. */
export const canRepeatMonthly = (t: Row) => t.kind === "receita" && !t.recurrence_id && !t.contract_id && !t.installment_group_id && t.status !== "cancelado";
