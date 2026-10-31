import type { Metadata } from "next";
import { Suspense } from "react";
import { ListChecks, Plus } from "lucide-react";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState, NoResults } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { getCrmLookups } from "@/features/crm/queries";
import { listTasks, type TaskFilters as Filters } from "@/features/tasks/queries";
import { TasksView } from "@/features/tasks/components/tasks-view";
import { TaskFilters } from "@/features/tasks/components/task-filters";
import { TaskFormDialog } from "@/features/tasks/components/task-form-dialog";

export const metadata: Metadata = { title: "Tarefas" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" && v ? v : undefined;
}

export default async function TarefasPage({ searchParams }: PageProps<"/tarefas">) {
  const user = await requirePermission("tasks.read");
  const sp = await searchParams;
  const scope = user.permissions["tasks.read"];
  const filters: Filters = {
    q: str(sp.q)?.slice(0, 100),
    responsavel: str(sp.responsavel),
    status: (str(sp.status) as Filters["status"]) ?? "abertas",
    prioridade: str(sp.prioridade),
    periodo: str(sp.periodo) as Filters["periodo"],
  };
  const mode = str(sp.modo) === "quadro" ? "quadro" : "lista";
  // No quadro mostramos também as concluídas para permitir arrastar entre colunas.
  const [tasks, lookups] = await Promise.all([listTasks(mode === "quadro" && !sp.status ? { ...filters, status: "todas" } : filters), getCrmLookups()]);
  const canAssign = scope === "team" || scope === "all";
  const hasFilters = Boolean(filters.q || filters.responsavel || filters.prioridade || filters.periodo || sp.status);

  const newTask = user.permissions["tasks.create"] ? (
    <TaskFormDialog
      owners={lookups.owners}
      canAssign={user.permissions["tasks.create"] !== "own"}
      trigger={
        <Button>
          <Plus aria-hidden="true" /> Nova tarefa
        </Button>
      }
    />
  ) : null;

  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Trabalho" }, { label: "Tarefas" }]} title="Tarefas" description={`${tasks.length} tarefa(s).`} actions={newTask} />
      <PageBody className="grid gap-4">
        <Suspense>
          <TaskFilters owners={lookups.owners} canSeeOthers={canAssign} />
        </Suspense>
        {tasks.length === 0 ? (
          hasFilters ? (
            <NoResults query={filters.q} />
          ) : (
            <EmptyState icon={ListChecks} title="Nenhuma tarefa em aberto" description="Crie uma tarefa ou inicie uma cadência em um lead para gerar as próximas ações." action={newTask} />
          )
        ) : (
          <TasksView tasks={tasks} owners={lookups.owners} canAssign={canAssign} canDelete={Boolean(user.permissions["tasks.delete"])} mode={mode} />
        )}
      </PageBody>
    </>
  );
}
