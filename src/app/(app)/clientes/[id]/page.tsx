import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, FilePlus2 } from "lucide-react";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/domain/shared/money";
import { formatDate, formatDateTime } from "@/domain/shared/dates";
import { formatDocument } from "@/domain/shared/document";
import { formatPhone } from "@/domain/shared/phone";
import { getClient, listAttachments, listContracts, listServices } from "@/features/clients/queries";
import { monthlyValue } from "@/features/clients/types";
import { getCrmLookups, getLeadActivities } from "@/features/crm/queries";
import { ACTIVITY_LABEL } from "@/features/crm/types";
import { ContractDialog } from "@/features/clients/components/contract-dialog";
import { ContractsTable } from "@/features/clients/components/contracts-table";
import { ClientEditDialog } from "@/features/clients/components/client-edit-dialog";
import { Attachments } from "@/features/clients/components/attachments";
import { getClientTeam, listPeople } from "@/features/squads/queries";
import { ClientTeam } from "@/features/squads/components/client-team";

export const metadata: Metadata = { title: "Cliente" };

export default async function ClientePage({ params }: PageProps<"/clientes/[id]">) {
  const user = await requirePermission("clients.read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  // A lista de pessoas só vai para o navegador de quem pode associar.
  const canManageTeam = Boolean(user.permissions["admin.users"]);
  // Tudo o que só depende do id começa junto com o cliente (antes, esperava o cliente chegar).
  const rest = Promise.all([
    user.permissions["contracts.read"] ? listContracts({ cliente: id }) : Promise.resolve([]),
    listServices(),
    listAttachments("client", id),
    getCrmLookups(),
    getClientTeam(id),
    canManageTeam ? listPeople() : Promise.resolve(null),
  ]);
  rest.catch(() => null);
  const client = await getClient(id);
  if (!client) notFound();
  const [[contracts, services, attachments, lookups, team, people], activities] = await Promise.all([rest, getLeadActivities(client.lead_id, 30).catch(() => [])]);
  const names = new Map(lookups.owners.map((o) => [o.id, o.full_name || o.email]));
  const mrr = contracts.reduce((s, k) => s + monthlyValue(k), 0);
  const total = contracts.filter((k) => k.status !== "cancelado").reduce((s, k) => s + (k.amount_cents ?? 0), 0);
  // Cartões de valores só com contratos visíveis e contracts.values (sem isso, "R$ 0,00" enganaria).
  const showValues = Boolean(user.permissions["contracts.read"] && user.permissions["contracts.values"]);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Clientes", href: "/clientes" }, { label: client.lead?.name ?? "Cliente" }]}
        title={client.lead?.name ?? "Cliente"}
        description={`Cliente desde ${formatDate(client.converted_at)}${client.status === "inativo" ? " · inativo" : ""}`}
        actions={
          <>
            {user.permissions["contracts.create"] && (
              <ContractDialog
                clientId={id}
                services={services}
                trigger={
                  <Button>
                    <FilePlus2 aria-hidden="true" /> Novo contrato
                  </Button>
                }
              />
            )}
            {user.permissions["clients.update"] && <ClientEditDialog client={client} />}
            <Button asChild variant="ghost">
              <Link href={`/crm/leads/${client.lead_id}`}>
                Ver no CRM <ExternalLink aria-hidden="true" />
              </Link>
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="grid content-start gap-6">
            {showValues && (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-surface p-3">
                <dt className="text-xs text-muted-foreground">Recorrente por mês</dt>
                <dd className="tabular text-xl font-semibold">{formatBRL(mrr)}</dd>
              </div>
              <div className="rounded-lg border bg-surface p-3">
                <dt className="text-xs text-muted-foreground">Contratos ativos</dt>
                <dd className="tabular text-xl font-semibold">{contracts.filter((k) => k.status === "ativo").length}</dd>
              </div>
              <div className="rounded-lg border bg-surface p-3">
                <dt className="text-xs text-muted-foreground">Valor contratado</dt>
                <dd className="tabular text-xl font-semibold">{formatBRL(total)}</dd>
              </div>
            </dl>
            )}

            {user.permissions["contracts.read"] && (
            <section aria-labelledby="contratos" className="grid gap-2">
              <h2 id="contratos" className="text-sm font-semibold">
                Contratos
              </h2>
              {contracts.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum contrato. Use “Novo contrato” para registrar o serviço contratado.</p> : <ContractsTable contracts={contracts} showClient={false} />}
            </section>
            )}

            <Attachments entityType="client" entityId={id} initial={attachments} />

            <section aria-labelledby="historico" className="grid gap-2">
              <h2 id="historico" className="text-sm font-semibold">
                Histórico (desde quando era lead)
              </h2>
              <ol className="relative grid gap-3 border-l pl-4">
                {activities.map((a) => (
                  <li key={a.id} className="relative text-sm">
                    <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background bg-primary" aria-hidden="true" />
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{ACTIVITY_LABEL[a.type]}</span> · {formatDateTime(a.occurred_at)}
                      {a.created_by && ` · ${names.get(a.created_by) ?? ""}`}
                    </p>
                    {a.content && <p className="whitespace-pre-wrap">{a.content}</p>}
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <aside className="grid content-start gap-4 text-sm" aria-label="Dados do cliente">
            {!client.billing_hidden && (
            <section className="grid gap-1">
              <h2 className="text-sm font-semibold">Cobrança</h2>
              <p>{client.legal_name || "Razão social não informada"}</p>
              <p className="text-muted-foreground">{client.document ? formatDocument(client.document) : "Sem CPF/CNPJ"}</p>
              <p>{client.billing_email || client.lead?.email || "Sem e-mail"}</p>
              <p>{formatPhone(client.billing_phone_e164 ?? client.lead?.phone_e164) || "Sem telefone"}</p>
            </section>
            )}
            <section className="grid gap-1">
              <h2 className="text-sm font-semibold">Responsável</h2>
              <p>{client.owner_id ? (names.get(client.owner_id) ?? "—") : "—"}</p>
            </section>
            <ClientTeam clientId={id} team={team} people={people} />
            {client.notes && (
              <section className="grid gap-1">
                <h2 className="text-sm font-semibold">Observações</h2>
                <p className="whitespace-pre-wrap text-muted-foreground">{client.notes}</p>
              </section>
            )}
          </aside>
        </div>
      </PageBody>
    </>
  );
}
