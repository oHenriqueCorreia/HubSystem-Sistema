import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/dal";
import { canCreateWorkspaces } from "@/features/admin/queries";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { ImportWizard } from "@/features/crm/components/import-wizard";
import { getCrmLookups, listProspectorImports } from "@/features/crm/queries";

export const metadata: Metadata = { title: "Prospectador" };

export default async function ProspectadorPage() {
  await requirePermission("crm.leads.import");
  // O conector roda no computador do dono da plataforma; outras contas não têm o que abrir aqui.
  if (!(await canCreateWorkspaces())) redirect("/crm/importar");
  const [lookups, added] = await Promise.all([getCrmLookups(), listProspectorImports()]);
  return <>
    <PageHeader breadcrumbs={[{ label: "Leads", href: "/crm/leads" }, { label: "Prospectador" }]}
      title="Prospectador" description="Encontre empresas pelo seu computador e leve os resultados para o seu funil." />
    <PageBody className="grid gap-6">
      <ImportWizard source="prospector" pipelines={lookups.pipelines.map((p) => ({ id: p.id, name: p.name }))} prospector={{ added, segments: lookups.segments }} />
      <Link className="text-sm text-primary underline" href="/crm/importar">Ver histórico de importações ou importar uma planilha</Link>
    </PageBody>
  </>;
}
