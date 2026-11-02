import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/dal";
import { canCreateWorkspaces } from "@/features/admin/queries";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/domain/shared/dates";
import { getCrmLookups, listImports } from "@/features/crm/queries";
import { ImportWizard, UndoButton } from "@/features/crm/components/import-wizard";

export const metadata: Metadata = { title: "Importar leads" };

export default async function ImportarPage() {
  await requirePermission("crm.leads.import");
  const [lookups, imports, owner] = await Promise.all([getCrmLookups(), listImports(), canCreateWorkspaces()]);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Leads", href: "/crm/leads" }, { label: "Importar" }]}
        title="Importar leads"
        description="Envie planilhas exportadas do Google Maps ou de outra fonte. Nada é gravado antes da sua confirmação."
      />
      <PageBody className="grid gap-10">
        {owner && <Link href="/crm/prospectador" className="text-sm text-primary underline">Buscar diretamente no prospectador deste computador</Link>}
        <ImportWizard pipelines={lookups.pipelines.map((p) => ({ id: p.id, name: p.name }))} />

        {imports.length > 0 && (
          <section aria-labelledby="historico" className="grid gap-2">
            <h2 id="historico" className="text-sm font-semibold">
              Importações recentes
            </h2>
            <div className="overflow-x-auto rounded-lg border bg-surface">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Arquivo</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead className="text-right">Linhas</TableHead>
                    <TableHead className="text-right">Novos</TableHead>
                    <TableHead className="text-right">Ignorados</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>
                      <span className="sr-only">Ações</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {imports.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="max-w-64 truncate">{i.file_name}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDateTime(i.created_at)}</TableCell>
                      <TableCell className="text-right">{i.total_rows}</TableCell>
                      <TableCell className="text-right">{i.inserted}</TableCell>
                      <TableCell className="text-right">{i.skipped}</TableCell>
                      <TableCell>{i.undone_at ? `Desfeita em ${formatDateTime(i.undone_at)}` : "Concluída"}</TableCell>
                      <TableCell className="text-right">{!i.undone_at && i.inserted > 0 && <UndoButton importId={i.id} />}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        )}
      </PageBody>
    </>
  );
}
