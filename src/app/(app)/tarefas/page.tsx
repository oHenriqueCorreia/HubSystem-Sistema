import type { Metadata } from "next";
import { Suspense } from "react";
import { ListChecks, Plus } from "lucide-react";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState, NoResults } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { getCrmLookups } from "@/features/crm/queries";
import { getTask, listClientOptions, listTaskBoards, listTaskColumns, listTasks, type TaskFilters as Filters } from "@/features/tasks/queries";
import { BoardBar } from "@/features/tasks/components/board-bar";
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
    tag: str(sp.etiqueta),
    aprovacao: (["aguardando", "aprovado", "recusado"] as const).find((a) => a === str(sp.aprovacao)),
  };
  const linkId = str(sp.tarefa);
  const [boards, linked, clients] = await Promise.all([listTaskBoards(), linkId && /^[0-9a-f-]{36}$/i.test(linkId) ? getTask(linkId) : Promise.resolve(null), listClientOptions()]);
  const mode = str(sp.modo) === "quadro" ? "quadro" : "lista";
  const pickedBoard = boards.find((b) => b.id === str(sp.quadro)) ?? null;
  // No quadro sempre há um quadro aberto; na lista, o quadro é um filtro opcional.
  const board = pickedBoard ?? (mode === "quadro" ? (boards.find((b) => b.id === linked?.task.list?.board?.id) ?? boards[0] ?? null) : null);
  const columns = board ? await listTaskColumns(board.id) : [];
  // No quadro mostramos também as concluídas para permitir arrastar entre listas.
  const [tasks, lookups] = await Promise.all([
    listTasks({ ...(mode === "quadro" && !sp.status ? { ...filters, status: "todas" as const } : filters), ...(board ? { columnIds: columns.map((c) => c.id) } : {}) }),
    getCrmLookups(),
  ]);
  const canAssign = scope === "team" || scope === "all";
  const hasFilters = Boolean(filters.q || filters.responsavel || filters.prioridade || filters.periodo || filters.tag || filters.aprovacao || sp.status || pickedBoard);
  const canConfigure = Boolean(user.permissions["tasks.board.configure"]);

  const newTask = user.permissions["tasks.create"] ? (
    <TaskFormDialog
      owners={lookups.owners}
      canAssign={user.permissions["tasks.create"] !== "own"}
      canConfigure={canConfigure}
      defaults={board ? { boardId: board.id } : undefined}
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
          <BoardBar boards={boards} current={board} clients={clients} canConfigure={canConfigure} />
          <TaskFilters owners={lookups.owners} canSeeOthers={canAssign} tags={lookups.tags} />
        </Suspense>
        {tasks.length === 0 && mode !== "quadro" && !linked ? (
          hasFilters ? (
            <NoResults query={filters.q} />
          ) : (
            <EmptyState icon={ListChecks} title="Nenhuma tarefa em aberto" description="Crie uma tarefa ou inicie uma cadência em um lead para gerar as próximas ações." action={newTask} />
          )
        ) : (
          <TasksView tasks={tasks} owners={lookups.owners} canAssign={canAssign} canCreate={Boolean(user.permissions["tasks.create"])} canDelete={Boolean(user.permissions["tasks.delete"])}
            canConfigure={canConfigure}
            columns={columns}
            mode={mode}
            boardId={board?.id}
            initialOpen={linked?.task ?? null}
          />
        )}
      </PageBody>
    </>
  );
}
