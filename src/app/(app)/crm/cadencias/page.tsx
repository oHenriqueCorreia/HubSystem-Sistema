import type { Metadata } from "next";
import { ArrowUpRight, BookOpenText, Pencil, Plus, Repeat } from "lucide-react";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listCadences } from "@/features/tasks/queries";
import { getCrmLookups } from "@/features/crm/queries";
import { RunCadencesButton } from "@/features/tasks/components/run-cadences-button";
import { CadenceEditor } from "@/features/tasks/components/cadence-editor";
import { CADENCE_PRESETS } from "@/features/tasks/cadence-presets";
import { CHANNEL_LABEL, type Channel } from "@/features/tasks/types";

export const metadata: Metadata = { title: "Cadências" };

export default async function CadenciasPage() {
  const user = await requirePermission("crm.cadences.read");
  const canManage = Boolean(user.permissions["crm.cadences.manage"]);
  const [cadences, lookups] = await Promise.all([listCadences(), getCrmLookups()]);
  const tags = lookups.tags.map((t) => ({ id: t.id, name: t.name }));
  const stages = lookups.pipelines.flatMap((p) => p.stages.map((st) => ({ id: st.id, label: `${p.name} · ${st.name}` })));

  const create = canManage ? (
    <CadenceEditor
      tags={tags}
      stages={stages}
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
        description="Planeje contatos com objetivo, contexto e próximo passo. Inicie uma sequência pela página de cada lead."
        actions={
          <>
            {canManage && <RunCadencesButton />}
            {create}
          </>
        }
      />
      <PageBody className="grid gap-6">
        <section className="grid gap-4 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-surface to-surface p-5 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-2">
            <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">Playbook comercial</p>
            <h2 className="text-xl font-semibold tracking-tight">Cada contato precisa de um motivo.</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">Defina o objetivo da etapa, personalize a mensagem e registre a resposta no lead. As etapas geram tarefas. Etapas marcadas como automáticas enviam modelos aprovados do WhatsApp no horário permitido, só para quem deu consentimento.</p>
          </div>
          <dl className="flex gap-5 text-sm">
            <div><dt className="text-muted-foreground">Ativas</dt><dd className="text-xl font-semibold tabular">{cadences.filter((c) => c.is_active).length}</dd></div>
            <div><dt className="text-muted-foreground">Leads inscritos</dt><dd className="text-xl font-semibold tabular">{cadences.reduce((sum, c) => sum + c.enrollments, 0)}</dd></div>
          </dl>
        </section>

        {canManage && (
          <section aria-labelledby="roteiros-prontos" className="grid gap-3">
            <div>
              <h2 id="roteiros-prontos" className="flex items-center gap-2 text-base font-semibold"><BookOpenText className="size-4 text-primary" aria-hidden="true" /> Comece por um roteiro</h2>
              <p className="text-sm text-muted-foreground">Modelos editáveis para situações diferentes. Revise os textos antes de salvar e usar com um lead.</p>
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              {CADENCE_PRESETS.map((preset) => (
                <article key={preset.id} className="grid content-between gap-4 rounded-xl border bg-surface p-4 shadow-xs">
                  <div className="grid gap-2">
                    <p className="text-xs font-semibold tracking-wide text-primary uppercase">{preset.values.steps.length} contatos planejados</p>
                    <h3 className="font-semibold">{preset.label}</h3>
                    <p className="text-sm text-muted-foreground">{preset.summary}</p>
                    <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Quando usar:</span> {preset.whenToUse}</p>
                  </div>
                  <CadenceEditor starter={preset.values} tags={tags} stages={stages} trigger={<Button variant="outline" className="w-full justify-between">Usar este roteiro <ArrowUpRight aria-hidden="true" /></Button>} />
                </article>
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="cadencias-salvas" className="grid gap-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div><h2 id="cadencias-salvas" className="text-base font-semibold">Cadências salvas</h2><p className="text-sm text-muted-foreground">Abra uma etapa para revisar a abordagem e a mensagem sugerida.</p></div>
            <span className="text-sm text-muted-foreground">{cadences.length} roteiro(s)</span>
          </div>
          {cadences.length === 0 ? (
            <EmptyState icon={Repeat} title="Nenhuma cadência salva" description="Crie uma sequência do zero ou adapte um dos roteiros acima." action={create} />
          ) : (
          <ul className="grid gap-4 xl:grid-cols-2">
            {cadences.map((c) => (
              <li key={c.id} className="grid content-start gap-4 rounded-xl border bg-surface p-4 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="grid gap-0.5">
                    <h2 className="flex items-center gap-2 font-semibold">
                      {c.name}
                      {!c.is_active && <Badge variant="secondary">Inativa</Badge>}
                    </h2>
                    {c.description && <p className="text-sm text-muted-foreground">{c.description}</p>}
                    <p className="text-xs text-muted-foreground">{c.steps.length} etapa(s) · {c.enrollments} lead(s) inscrito(s)</p>
                  </div>
                  {canManage && (
                    <CadenceEditor
                      template={c}
                      tags={tags}
                      stages={stages}
                      trigger={
                        <Button variant="ghost" size="sm">
                          <Pencil aria-hidden="true" /> Editar
                        </Button>
                      }
                    />
                  )}
                </div>
                <ol className="grid gap-2">
                  {c.steps.map((s, index) => (
                    <li key={s.id} className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
                      <div className="flex items-start gap-2.5">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{s.title}</p>
                          <p className="text-xs text-muted-foreground">{s.day_offset === 0 ? "No dia" : `Dia ${s.day_offset}`} · {s.time_of_day.slice(0, 5)} · {CHANNEL_LABEL[s.channel as Channel]}</p>
                        </div>
                      </div>
                      {(s.instruction || s.message) && (
                        <details className="mt-2 pl-8 text-xs">
                          <summary className="cursor-pointer font-medium text-primary">Ver orientação e mensagem</summary>
                          {s.instruction && <p className="mt-2 text-muted-foreground">{s.instruction}</p>}
                          {s.message && <div className="mt-2 rounded-md border bg-surface p-2.5 whitespace-pre-wrap"><span className="mb-1 block font-medium text-muted-foreground">Mensagem sugerida</span>{s.message}</div>}
                        </details>
                      )}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
          )}
        </section>
      </PageBody>
    </>
  );
}
