import type { Metadata } from "next";
import { Pencil, Plus, Repeat } from "lucide-react";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listCadences } from "@/features/tasks/queries";
import { CadenceEditor } from "@/features/tasks/components/cadence-editor";
import { CHANNEL_LABEL, type Channel } from "@/features/tasks/types";

export const metadata: Metadata = { title: "Cadências" };

export default async function CadenciasPage() {
  const user = await requirePermission("crm.cadences.read");
  const canManage = Boolean(user.permissions["crm.cadences.manage"]);
  const cadences = await listCadences();

  const create = canManage ? (
    <CadenceEditor
      trigger={
        <Button>
          <Plus aria-hidden="true" /> Nova cadência
        </Button>
      }
    />
  ) : null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Comercial" }, { label: "Cadências" }]}
        title="Cadências de prospecção"
        description="Sequências de contatos. Inicie uma cadência pela página do lead; cada etapa vira uma tarefa na agenda."
        actions={create}
      />
      <PageBody>
        {cadences.length === 0 ? (
          <EmptyState icon={Repeat} title="Nenhuma cadência" description="Crie uma sequência de contatos para padronizar a prospecção." action={create} />
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {cadences.map((c) => (
              <li key={c.id} className="grid content-start gap-3 rounded-xl border bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="grid gap-0.5">
                    <h2 className="flex items-center gap-2 font-semibold">
                      {c.name}
                      {!c.is_active && <Badge variant="secondary">Inativa</Badge>}
                    </h2>
                    {c.description && <p className="text-sm text-muted-foreground">{c.description}</p>}
                    <p className="text-xs text-muted-foreground">
                      {c.steps.length} etapa(s) · {c.enrollments} inscrição(ões)
                    </p>
                  </div>
                  {canManage && (
                    <CadenceEditor
                      template={c}
                      trigger={
                        <Button variant="ghost" size="sm">
                          <Pencil aria-hidden="true" /> Editar
                        </Button>
                      }
                    />
                  )}
                </div>
                <ol className="relative grid gap-3 border-l pl-4">
                  {c.steps.map((s) => (
                    <li key={s.id} className="relative text-sm">
                      <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-surface bg-primary" aria-hidden="true" />
                      <p className="text-xs text-muted-foreground">
                        {s.day_offset === 0 ? "No dia" : `Dia ${s.day_offset}`} · {s.time_of_day.slice(0, 5)} · {CHANNEL_LABEL[s.channel as Channel]}
                      </p>
                      <p className="font-medium">{s.title}</p>
                      {s.instruction && <p className="text-muted-foreground">{s.instruction}</p>}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
