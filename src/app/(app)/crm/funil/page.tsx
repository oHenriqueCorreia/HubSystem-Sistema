import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FileUp, Filter } from "lucide-react";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { getBoard, getCrmLookups } from "@/features/crm/queries";
import { Board } from "@/features/crm/components/board";
import { LeadFilters } from "@/features/crm/components/lead-filters";
import { CrmViewTabs } from "@/features/crm/components/crm-tabs";
import { PipelinePicker } from "@/features/crm/components/pipeline-picker";
import { PipelineConfig } from "@/features/crm/components/pipeline-config";

export const metadata: Metadata = { title: "Funil" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" && v ? v : undefined;
}

export default async function FunilPage({ searchParams }: PageProps<"/crm/funil">) {
  const user = await requirePermission("crm.leads.read");
  const sp = await searchParams;
  const lookups = await getCrmLookups();
  const pipeline = lookups.pipelines.find((p) => p.id === str(sp.funil)) ?? lookups.pipelines[0];

  if (!pipeline) {
    return (
      <>
        <PageHeader title="Funil" />
        <PageBody>
          <EmptyState icon={Filter} title="Nenhum funil configurado" description="Peça ao administrador para criar um funil em Configurações." />
        </PageBody>
      </>
    );
  }

  const cards = await getBoard(pipeline.id, {
    q: str(sp.q)?.slice(0, 100),
    responsavel: str(sp.responsavel),
    etiqueta: str(sp.etiqueta),
    segmento: str(sp.segmento),
  });
  const counts: Record<string, number> = {};
  for (const c of cards) counts[c.stage_id] = (counts[c.stage_id] ?? 0) + 1;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Comercial" }, { label: "Funil" }]}
        title={`Funil · ${pipeline.name}`}
        description={`${cards.length} negócio(s). Arraste os cartões ou use o menu “…” para mudar de etapa.`}
        actions={
          <>
            {user.permissions["crm.pipeline.configure"] && <PipelineConfig pipeline={pipeline} counts={counts} />}
            {user.permissions["crm.leads.import"] && (
              <Button asChild variant="outline">
                <Link href="/crm/importar">
                  <FileUp aria-hidden="true" /> Importar leads
                </Link>
              </Button>
            )}
          </>
        }
      />
      <PageBody className="grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Suspense>
            <CrmViewTabs />
          </Suspense>
          {lookups.pipelines.length > 1 && (
            <Suspense>
              <PipelinePicker pipelines={lookups.pipelines.map((p) => ({ id: p.id, name: p.name }))} value={pipeline.id} />
            </Suspense>
          )}
        </div>
        <Suspense>
          <LeadFilters lookups={lookups} pipelineId={pipeline.id} show="board" />
        </Suspense>
        {cards.length === 0 && !sp.q && !sp.responsavel && !sp.etiqueta && !sp.segmento ? (
          <EmptyState
            icon={Filter}
            title="Funil vazio"
            description="Importe leads ou cadastre um lead para ele aparecer na primeira etapa."
            action={
              <Button asChild>
                <Link href="/crm/importar">Importar leads</Link>
              </Button>
            }
          />
        ) : (
          <Board key={pipeline.id} pipeline={pipeline} cards={cards} lookups={lookups} canMove={Boolean(user.permissions["crm.pipeline.move"])} />
        )}
      </PageBody>
    </>
  );
}
