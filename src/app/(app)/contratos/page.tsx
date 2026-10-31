import type { Metadata } from "next";
import { FileSignature } from "lucide-react";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState, NoResults } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/domain/shared/money";
import { listContracts, listServices } from "@/features/clients/queries";
import { CONTRACT_STATUS_LABEL, monthlyValue } from "@/features/clients/types";
import { ContractsTable } from "@/features/clients/components/contracts-table";

export const metadata: Metadata = { title: "Contratos" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" && v ? v : undefined;
}

export default async function ContratosPage({ searchParams }: PageProps<"/contratos">) {
  await requirePermission("contracts.read");
  const sp = await searchParams;
  const filters = { q: str(sp.q)?.slice(0, 100), status: str(sp.status), servico: str(sp.servico) };
  const [contracts, services] = await Promise.all([listContracts(filters), listServices()]);
  const mrr = contracts.reduce((s, k) => s + monthlyValue(k), 0);
  const hasFilters = Boolean(filters.q || filters.status || filters.servico);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Comercial" }, { label: "Contratos" }]}
        title="Contratos"
        description={`${contracts.length} contrato(s) · recorrente ativo ${formatBRL(mrr)}/mês. Para criar, abra o cliente.`}
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
          hasFilters ? <NoResults query={filters.q} /> : <EmptyState icon={FileSignature} title="Nenhum contrato" description="Converta um lead em cliente ou abra um cliente para registrar o primeiro contrato." />
        ) : (
          <ContractsTable contracts={contracts} />
        )}
      </PageBody>
    </>
  );
}
