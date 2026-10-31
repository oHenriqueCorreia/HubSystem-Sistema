import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { listTagsWithUsage } from "@/features/tags/queries";
import { TagManager } from "@/features/tags/components/tag-manager";

export const metadata: Metadata = { title: "Etiquetas" };

export default async function EtiquetasPage() {
  await requirePermission(["tags.manage", "crm.pipeline.configure"]);
  const tags = await listTagsWithUsage();
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Configurações" }, { label: "Etiquetas" }]}
        title="Etiquetas"
        description="As mesmas etiquetas servem para tarefas, leads e conversas. Arquive as que não usa mais para manter o histórico."
      />
      <PageBody>
        <TagManager tags={tags} />
      </PageBody>
    </>
  );
}
