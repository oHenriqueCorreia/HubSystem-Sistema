import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requirePermission } from "@/lib/auth/dal";
import { canOnRecord } from "@/domain/permissions";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatBRL } from "@/domain/shared/money";
import { formatDate } from "@/domain/shared/dates";
import { getContract, listAttachments, listServices } from "@/features/clients/queries";
import { getCrmLookups } from "@/features/crm/queries";
import { CONTRACT_STATUS_LABEL, PAYMENT_LABEL, RECURRENCE_LABEL, monthlyValue } from "@/features/clients/types";
import { ContractDialog } from "@/features/clients/components/contract-dialog";
import { DeleteContractButton } from "@/features/clients/components/delete-contract-button";
import { Attachments } from "@/features/clients/components/attachments";
import { getContractReceivables, getLookups } from "@/features/finance/queries";
import { ReceivablesDialog } from "@/features/finance/components/receivables-dialog";

export const metadata: Metadata = { title: "Contrato" };

export default async function ContratoPage({ params }: PageProps<"/contratos/[id]">) {
  const user = await requirePermission("contracts.read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const contract = await getContract(id);
  if (!contract) notFound();
  const [services, attachments, lookups] = await Promise.all([listServices(), listAttachments("contract", id), getCrmLookups()]);
  const canEdit = canOnRecord(user.permissions, "contracts.update", contract.owner_id, user.id);
  const canDelete = canOnRecord(user.permissions, "contracts.delete", contract.owner_id, user.id);
  const owner = lookups.owners.find((o) => o.id === contract.owner_id);
  const canFinance = Boolean(user.permissions["finance.company.read"]);
  const [receivables, finLookups] = canFinance ? await Promise.all([getContractReceivables(id), getLookups("empresa")]) : [[], null];

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Contratos", href: "/contratos" },
          ...(contract.client ? [{ label: contract.client.lead?.name ?? "Cliente", href: `/clientes/${contract.client.id}` }] : []),
          { label: contract.title },
        ]}
        title={contract.title}
        description={contract.service?.name}
        actions={
          <>
            {canEdit && (
              <ContractDialog
                clientId={contract.client_id}
                contract={contract}
                services={services}
                owners={user.permissions["crm.leads.assign"] ? lookups.owners : undefined}
                trigger={
                  <Button>
                    <Pencil aria-hidden="true" /> Editar contrato
                  </Button>
                }
              />
            )}
            {canDelete && <DeleteContractButton id={id} clientId={contract.client_id} />}
          </>
        }
      />
      <PageBody className="grid gap-6">
        <dl className="grid gap-4 rounded-xl border bg-surface p-4 sm:grid-cols-3">
          <Item label="Situação">
            <Badge variant={contract.status === "ativo" ? "default" : "secondary"}>{CONTRACT_STATUS_LABEL[contract.status]}</Badge>
          </Item>
          {contract.amount_cents !== null && (
            <Item label="Valor">
              <span className="tabular text-lg font-semibold">{formatBRL(contract.amount_cents)}</span>
              {monthlyValue(contract) > 0 && contract.recurrence !== "mensal" && <span className="block text-xs text-muted-foreground">{formatBRL(monthlyValue(contract))}/mês</span>}
            </Item>
          )}
          <Item label="Recorrência">
            {RECURRENCE_LABEL[contract.recurrence]}
            {contract.due_day ? ` · vence dia ${contract.due_day}` : ""}
          </Item>
          <Item label="Forma de pagamento">{PAYMENT_LABEL[contract.payment_method]}</Item>
          <Item label="Vigência">
            {formatDate(contract.start_date)} {contract.end_date ? `a ${formatDate(contract.end_date)}` : "· sem término"}
          </Item>
          <Item label="Responsável">{owner?.full_name || owner?.email || "—"}</Item>
          <Item label="Cliente">
            {contract.client ? (
              <Link href={`/clientes/${contract.client.id}`} className="text-primary hover:underline">
                {contract.client.lead?.name ?? contract.client.legal_name}
              </Link>
            ) : (
              "—"
            )}
          </Item>
        </dl>
        {contract.description && (
          <section className="grid gap-1">
            <h2 className="text-sm font-semibold">Escopo</h2>
            <p className="max-w-prose text-sm whitespace-pre-wrap">{contract.description}</p>
          </section>
        )}
        {contract.notes && (
          <section className="grid gap-1">
            <h2 className="text-sm font-semibold">Observações</h2>
            <p className="max-w-prose text-sm whitespace-pre-wrap text-muted-foreground">{contract.notes}</p>
          </section>
        )}
        {canFinance && (
          <section aria-labelledby="cobrancas" className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="cobrancas" className="text-sm font-semibold">
                Cobranças no financeiro
              </h2>
              {user.permissions["finance.company.create"] && finLookups && receivables.length === 0 && contract.status === "ativo" && (
                <ReceivablesDialog contracts={[{ id, title: contract.title, clientName: contract.client?.lead?.name ?? "" }]} lookups={finLookups} defaultContract={id} />
              )}
            </div>
            {receivables.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma cobrança gerada para este contrato.</p>
            ) : (
              <ul className="grid gap-1 text-sm">
                {receivables.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border bg-surface px-3 py-2">
                    <span>{formatDate(r.due_date)}</span>
                    <span className="tabular">{formatBRL(r.amount_cents)}</span>
                    <span className={r.status === "pago" ? "text-success" : "text-muted-foreground"}>{r.status === "pago" ? `Recebido ${r.paid_at ? formatDate(r.paid_at) : ""}` : r.status === "cancelado" ? "Cancelado" : "Em aberto"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <Attachments entityType="contract" entityId={id} initial={attachments} title="Documentos do contrato" canUpload={canEdit} />
      </PageBody>
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}
