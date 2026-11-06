import type { Metadata } from "next";
import { FileSignature } from "lucide-react";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState, NoResults } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/domain/shared/money";
import { listClients, listContracts, listServices } from "@/features/clients/queries";
import { NewContractDialog } from "@/features/clients/components/new-contract-dialog";
import { getLookups } from "@/features/finance/queries";
import { createClient } from "@/lib/supabase/server";
import { CONTRACT_STATUS_LABEL, monthlyValue } from "@/features/clients/types";
import { ContractsTable } from "@/features/clients/components/contracts-table";

export const metadata: Metadata = { title: "Contratos" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" && v ? v : undefined;
}

export default async function ContratosPage({ searchParams }: PageProps<"/contratos">) {
  const user = await requirePermission("contracts.read");
  const canCreate = Boolean(user.permissions["contracts.create"]);
  const canCreateClient = Boolean(user.permissions["clients.create"]);
  const sp = await searchParams;
  const filters = { q: str(sp.q)?.slice(0, 100), status: str(sp.status), servico: str(sp.servico) };
  const supabase = await createClient();
  const [contracts, services, clients, leads, finance] = await Promise.all([
    listContracts(filters),
    listServices(),
    canCreate ? listClients({ status: "ativo" }) : Promise.resolve([]),
    canCreate && canCreateClient
      ? supabase.from("leads").select("id, name, company_name").is("deleted_at", null).neq("status", "cliente").order("name").limit(1000)
      : Promise.resolve({ data: [] }),
    canCreate && user.permissions["finance.company.create"] ? getLookups("empresa") : Promise.resolve(null),
  ]);
  const mrr = contracts.reduce((s, k) => s + monthlyValue(k), 0);
  const hasFilters = Boolean(filters.q || filters.status || filters.servico);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Comercial" }, { label: "Contratos" }]}
        title="Contratos"
        description={user.permissions["contracts.values"] ? `${contracts.length} contrato(s) · recorrente ativo ${formatBRL(mrr)}/mês.` : `${contracts.length} contrato(s).`}
        actions={
          canCreate ? (
            <NewContractDialog
              clients={clients.map((c) => ({ id: c.id, name: c.lead?.name ?? c.legal_name ?? "Cliente" })).sort((a, b) => a.name.localeCompare(b.name))}
              leads={((leads.data ?? []) as { id: string; name: string; company_name: string | null }[]).map((l) => ({ id: l.id, name: l.company_name && l.company_name !== l.name ? `${l.name} (${l.company_name})` : l.name }))}
              services={services}
              finance={finance}
              canCreateClient={canCreateClient}
            />
          ) : null
        }
      />
      <PageBody className="grid gap-4">
        <form className="flex flex-wrap gap-2" role="search" aria-label="Filtrar contratos">
          <Input name="q" type="search" defaultValue={filters.q} placeholder="Buscar pelo título" aria-label="Buscar contratos" className="w-full sm:w-64" />
          <select name="status" defaultValue={filters.status ?? ""} aria-label="Situação" className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="">Todas as situações</option>
            {Object.entries(CONTRACT_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select name="servico" defaultValue={filters.servico ?? ""} aria-label="Serviço" className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="">Todos os serviços</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline">
            Filtrar
          </Button>
        </form>
        {contracts.length === 0 ? (
          hasFilters ? <NoResults query={filters.q} /> : <EmptyState icon={FileSignature} title="Nenhum contrato" description="Clique em “Novo contrato” para escolher o cliente, anexar o contrato e lançar as mensalidades no financeiro." />
        ) : (
          <ContractsTable contracts={contracts} />
        )}
      </PageBody>
    </>
  );
}
