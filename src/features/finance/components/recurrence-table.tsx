"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { formatBRL } from "@/domain/shared/money";
import { formatDate } from "@/domain/shared/dates";
import { setRecurrenceState } from "../actions";
import type { RecurrenceRow } from "../queries";

/** Como o vencimento é calculado: "todo 5º dia útil" ou "todo dia 10". */
function dueRuleLabel(r: Pick<RecurrenceRow, "due_rule" | "business_day" | "start_date" | "frequency">) {
  if (r.due_rule === "dia_util" && r.business_day) return `Vence no ${r.business_day}º dia útil`;
  if (r.frequency === "semanal") return "Toda semana, no mesmo dia";
  return `Vence todo dia ${Number(r.start_date.slice(8, 10))}`;
}

const FREQ: Record<RecurrenceRow["frequency"], string> = { semanal: "Semanal", mensal: "Mensal", trimestral: "Trimestral", semestral: "Semestral", anual: "Anual" };
const STATE: Record<RecurrenceRow["state"], { label: string; variant: "default" | "secondary" | "outline" }> = {
  ativa: { label: "Ativa", variant: "default" },
  pausada: { label: "Pausada", variant: "secondary" },
  encerrada: { label: "Encerrada", variant: "outline" },
};

export function RecurrenceTable({ rows, categories, clients, canEdit }: { rows: RecurrenceRow[]; categories: Map<string, string>; clients?: Map<string, string>; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function change(id: string, state: RecurrenceRow["state"]) {
    startTransition(async () => {
      const res = await setRecurrenceState({ id, state });
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
      router.refresh();
    });
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Descrição</TableHead>
            <TableHead>Periodicidade</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead className="text-right">Por mês</TableHead>
            <TableHead>Próximo vencimento</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead>
              <span className="sr-only">Ações</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className={r.state !== "ativa" ? "text-muted-foreground" : undefined}>
              <TableCell>
                <div className="font-medium">
                  {r.contract_id ? (
                    <Link href={`/contratos/${r.contract_id}`} className="hover:underline">
                      {r.description}
                    </Link>
                  ) : (
                    r.description
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.kind === "receita" ? "Receita" : "Despesa"}
                  {r.category_id && categories.get(r.category_id) ? ` · ${categories.get(r.category_id)}` : ""}
                  {r.client_id && clients?.get(r.client_id) ? ` · Cliente: ${clients.get(r.client_id)}` : ""}
                  {r.end_date ? ` · até ${formatDate(r.end_date)}` : " · sem data de término"}
                </div>
              </TableCell>
              <TableCell>
                <div>{FREQ[r.frequency]}</div>
                <div className="text-xs text-muted-foreground">{dueRuleLabel(r)}</div>
              </TableCell>
              <TableCell className="tabular text-right">{formatBRL(r.amount_cents)}</TableCell>
              <TableCell className="tabular text-right">{formatBRL(r.monthly_cents)}</TableCell>
              <TableCell className="whitespace-nowrap">{r.next_due ? formatDate(r.next_due) : "—"}</TableCell>
              <TableCell>
                <Badge variant={STATE[r.state].variant}>{STATE[r.state].label}</Badge>
              </TableCell>
              <TableCell>
                {canEdit && r.state !== "encerrada" && (
                  <div className="flex justify-end gap-1">
                    {r.state === "ativa" ? (
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => change(r.id, "pausada")}>
                        <Pause aria-hidden="true" /> Pausar
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => change(r.id, "ativa")}>
                        <Play aria-hidden="true" /> Retomar
                      </Button>
                    )}
                    <ConfirmDialog
                      tone="danger"
                      trigger={
                        <Button variant="ghost" size="sm" disabled={pending}>
                          <Square aria-hidden="true" /> Encerrar
                        </Button>
                      }
                      title={`Encerrar “${r.description}”?`}
                      description="As ocorrências futuras previstas vão para a lixeira. Lançamentos passados, pagos ou conciliados não mudam. Não é possível retomar uma série encerrada."
                      confirmLabel="Encerrar recorrência"
                      onConfirm={() => change(r.id, "encerrada")}
                    />
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
