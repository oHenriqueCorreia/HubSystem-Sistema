import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatBRL } from "@/domain/shared/money";
import { formatDate } from "@/domain/shared/dates";
import { CONTRACT_STATUS_LABEL, RECURRENCE_LABEL, type Contract } from "../types";

const STATUS_VARIANT: Record<Contract["status"], "default" | "secondary" | "outline" | "destructive"> = {
  ativo: "default",
  rascunho: "outline",
  pausado: "secondary",
  encerrado: "secondary",
  cancelado: "destructive",
};

export function ContractsTable({ contracts, showClient = true }: { contracts: Contract[]; showClient?: boolean }) {
  // Sem contracts.values os valores chegam nulos: a coluna some em vez de mostrar vazio.
  const showAmount = contracts.some((k) => k.amount_cents !== null);
  return (
    <div className="overflow-x-auto rounded-xl border bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Contrato</TableHead>
            {showClient && <TableHead>Cliente</TableHead>}
            <TableHead>Situação</TableHead>
            {showAmount && <TableHead className="text-right">Valor</TableHead>}
            <TableHead>Recorrência</TableHead>
            <TableHead>Vigência</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contracts.map((k) => (
            <TableRow key={k.id}>
              <TableCell>
                <Link href={`/contratos/${k.id}`} className="font-medium hover:underline">
                  {k.title}
                </Link>
                {k.service && <div className="text-xs text-muted-foreground">{k.service.name}</div>}
              </TableCell>
              {showClient && (
                <TableCell>
                  {k.client ? (
                    <Link href={`/clientes/${k.client.id}`} className="hover:underline">
                      {k.client.lead?.name ?? k.client.legal_name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
              )}
              <TableCell>
                <Badge variant={STATUS_VARIANT[k.status]}>{CONTRACT_STATUS_LABEL[k.status]}</Badge>
              </TableCell>
              {showAmount && <TableCell className="text-right whitespace-nowrap">{formatBRL(k.amount_cents)}</TableCell>}
              <TableCell className="whitespace-nowrap">
                {RECURRENCE_LABEL[k.recurrence]}
                {k.due_day ? ` · dia ${k.due_day}` : ""}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {formatDate(k.start_date)}
                {k.end_date ? ` a ${formatDate(k.end_date)}` : " · sem término"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
