import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Download, FileUp, Plus, UsersRound } from "lucide-react";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState, NoResults } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { getCrmLookups, listLeads, type LeadFilters as Filters } from "@/features/crm/queries";
import { LeadFilters } from "@/features/crm/components/lead-filters";
import { LeadsTable } from "@/features/crm/components/leads-table";
import { LeadFormDialog } from "@/features/crm/components/lead-form-dialog";
import { CrmViewTabs } from "@/features/crm/components/crm-tabs";

export const metadata: Metadata = { title: "Leads" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" && v ? v : undefined;
}

export default async function LeadsPage({ searchParams }: PageProps<"/crm/leads">) {
  const user = await requirePermission("crm.leads.read");
  const sp = await searchParams;
  const filters: Filters = {
    q: str(sp.q)?.slice(0, 100),
    etapa: str(sp.etapa),
    responsavel: str(sp.responsavel),
    segmento: str(sp.segmento),
    etiqueta: str(sp.etiqueta),
    status: str(sp.status),
    contato: str(sp.contato) as Filters["contato"],
    ordem: str(sp.ordem) as Filters["ordem"],
    pagina: Number(str(sp.pagina) ?? 1) || 1,
  };

  const lookups = await getCrmLookups();
  const result = await listLeads(filters, lookups.pipelines[0]?.id);
  const hasFilters = Boolean(filters.q || filters.etapa || filters.responsavel || filters.segmento || filters.etiqueta || filters.status || filters.contato);
  const canCreate = Boolean(user.permissions["crm.leads.create"]);
  const canImport = Boolean(user.permissions["crm.leads.import"]);
  const canAssign = Boolean(user.permissions["crm.leads.assign"]);

  const pageHref = (p: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) next.set(k, v);
    next.set("pagina", String(p));
    return `/crm/leads?${next.toString()}`;
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Comercial" }, { label: "Leads" }]}
        title="Leads"
        description={`${result.total.toLocaleString("pt-BR")} lead(s)${hasFilters ? " com estes filtros" : ""}.`}
        actions={
          <>
            <Button asChild variant="outline">
              <a href={`/api/crm/leads/export?${new URLSearchParams(Object.entries(sp).filter((entry): entry is [string, string] => typeof entry[1] === "string")).toString()}`}>
                <Download aria-hidden="true" /> Exportar CSV
              </a>
            </Button>
            {canImport && (
              <Button asChild variant="outline">
                <Link href="/crm/importar">
                  <FileUp aria-hidden="true" /> Importar leads
                </Link>
              </Button>
            )}
            {canCreate && (
              <LeadFormDialog
                lookups={lookups}
                canAssign={canAssign}
                trigger={
                  <Button>
                    <Plus aria-hidden="true" /> Novo lead
                  </Button>
                }
              />
            )}
          </>
        }
      />
      <PageBody className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Suspense>
            <CrmViewTabs />
          </Suspense>
        </div>
        <Suspense>
          <LeadFilters lookups={lookups} pipelineId={lookups.pipelines[0]?.id} />
        </Suspense>

        {result.rows.length === 0 ? (
          hasFilters ? (
            <NoResults
              query={filters.q}
              onClear={
                <Button asChild variant="outline">
                  <Link href="/crm/leads">Limpar filtros</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={UsersRound}
              title="Nenhum lead ainda"
              description="Importe uma planilha do Google Maps (CSV ou XLSX) ou cadastre o primeiro lead manualmente."
              action={
                <>
                  {canImport && (
                    <Button asChild>
                      <Link href="/crm/importar">
                        <FileUp aria-hidden="true" /> Importar leads
                      </Link>
                    </Button>
                  )}
                  {canCreate && (
                    <LeadFormDialog
                      lookups={lookups}
                      canAssign={canAssign}
                      trigger={
                        <Button variant="outline">
                          <Plus aria-hidden="true" /> Cadastrar lead
                        </Button>
                      }
                    />
                  )}
                </>
              }
            />
          )
        ) : (
          <>
            <LeadsTable rows={result.rows} lookups={lookups} canAssign={canAssign} userName={user.fullName} />
            {result.pageCount > 1 && (
              <nav aria-label="Paginação" className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  Página {result.page} de {result.pageCount}
                </span>
                <div className="flex gap-2">
                  <Button asChild variant="outline" size="sm" aria-disabled={result.page <= 1} className={result.page <= 1 ? "pointer-events-none opacity-50" : ""}>
                    <Link href={pageHref(result.page - 1)} tabIndex={result.page <= 1 ? -1 : undefined}>
                      Anterior
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    aria-disabled={result.page >= result.pageCount}
                    className={result.page >= result.pageCount ? "pointer-events-none opacity-50" : ""}
                  >
                    <Link href={pageHref(result.page + 1)} tabIndex={result.page >= result.pageCount ? -1 : undefined}>
                      Próxima
                    </Link>
                  </Button>
                </div>
              </nav>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
