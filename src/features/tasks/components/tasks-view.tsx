"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { cn } from "cn";
import { dayKey } from "@/domain/calendar";
import { todayLocal } from "@/domain/shared/dates";
import { positionBetween } from "@/features/crm/types";
import { moveTask } from "../actions";
import { STATUS_LABEL, type Task, type TaskStatus } from "../types";
import { TaskItem } from "./task-item";
import { TaskSheet } from "./task-sheet";

type Owner = { id: string; full_name: string; email: string };

function groups(tasks: Task[], now: number) {
  const today = todayLocal(new Date(now));
  const inAWeek = dayKey(new Date(now + 7 * 86_400_000));
  const out: { key: string; label: string; items: Task[] }[] = [
    { key: "atrasadas", label: "Atrasadas", items: [] },
    { key: "hoje", label: "Hoje", items: [] },
    { key: "semana", label: "Próximos 7 dias", items: [] },
    { key: "depois", label: "Mais tarde", items: [] },
    { key: "sem", label: "Sem prazo", items: [] },
    { key: "feitas", label: "Concluídas", items: [] },
  ];
  for (const t of tasks) {
    if (t.status === "concluida" || t.status === "cancelada") out[5].items.push(t);
    else if (!t.due_at) out[4].items.push(t);
    else if (new Date(t.due_at).getTime() < now) out[0].items.push(t);
    else if (dayKey(t.due_at) === today) out[1].items.push(t);
    else if (dayKey(t.due_at) <= inAWeek) out[2].items.push(t);
    else out[3].items.push(t);
  }
  return out.filter((g) => g.items.length);
}

export function TasksView({
  tasks,
  owners,
  canAssign,
  canDelete,
  mode,
}: {
  tasks: Task[];
  owners: Owner[];
  canAssign: boolean;
  canDelete: boolean;
  mode: "lista" | "quadro";
}) {
  const [now] = useState(() => Date.now());
  const [open, setOpen] = useState<Task | null>(null);
  const names = useMemo(() => new Map(owners.map((o) => [o.id, o.full_name || o.email])), [owners]);
  // Mantém o painel com os dados mais recentes após cada refresh.
  const openTask = open ? (tasks.find((t) => t.id === open.id) ?? open) : null;

  return (
    <>
      {mode === "lista" ? (
        <div className="grid gap-6">
          {groups(tasks, now).map((g) => (
            <section key={g.key} aria-labelledby={`g-${g.key}`} className="grid gap-2">
              <h2 id={`g-${g.key}`} className={cn("text-sm font-semibold", g.key === "atrasadas" && "text-danger")}>
                {g.label} <span className="tabular font-normal text-muted-foreground">({g.items.length})</span>
              </h2>
              <ul className="grid gap-2">
                {g.items.map((t) => (
                  <TaskItem key={t.id} task={t} now={now} ownerName={canAssign && t.owner_id ? names.get(t.owner_id) : undefined} onOpen={setOpen} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <TaskBoard tasks={tasks} now={now} onOpen={setOpen} />
      )}
      <TaskSheet task={openTask} onClose={() => setOpen(null)} owners={owners} canAssign={canAssign} canDelete={canDelete} />
    </>
  );
}

const COLUMNS: TaskStatus[] = ["a_fazer", "em_andamento", "concluida"];

function TaskBoard({ tasks, now, onOpen }: { tasks: Task[]; now: number; onOpen: (t: Task) => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const initial = () => Object.fromEntries(COLUMNS.map((c) => [c, tasks.filter((t) => t.status === c).sort((a, b) => a.position - b.position)])) as Record<TaskStatus, Task[]>;
  const [cols, setCols] = useState(initial);
  const [source, setSource] = useState(tasks);
  if (source !== tasks) {
    setSource(tasks);
    setCols(initial());
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function columnOf(id: string): TaskStatus | undefined {
    if ((COLUMNS as string[]).includes(id)) return id as TaskStatus;
    return COLUMNS.find((c) => cols[c].some((t) => t.id === id));
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const from = columnOf(String(active.id));
    const to = columnOf(String(over.id));
    if (!from || !to) return;
    const before = cols;
    const card = cols[from].find((t) => t.id === active.id)!;
    const dest = cols[to].filter((t) => t.id !== card.id);
    const overIndex = dest.findIndex((t) => t.id === over.id);
    const index = overIndex >= 0 ? overIndex : dest.length;
    const position = positionBetween(dest[index - 1]?.position ?? null, dest[index]?.position ?? null);
    dest.splice(index, 0, { ...card, status: to, position });
    setCols({ ...cols, [from]: cols[from].filter((t) => t.id !== card.id), [to]: dest });
    startTransition(async () => {
      const res = await moveTask({ id: card.id, status: to, position });
      if (!res.ok) {
        setCols(before);
        toast.error(res.message);
      } else {
        if (from !== to) toast.success(`Tarefa movida para ${STATUS_LABEL[to]}.`);
        router.refresh();
      }
    });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragEnd={onDragEnd}
      accessibility={{ screenReaderInstructions: { draggable: "Pressione espaço para pegar, setas para mover entre colunas e espaço para soltar." } }}
    >
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
        {COLUMNS.map((c) => (
          <BoardColumn key={c} id={c} label={STATUS_LABEL[c]} count={cols[c].length}>
            <SortableContext items={cols[c].map((t) => t.id)} strategy={verticalListSortingStrategy}>
              {cols[c].map((t) => (
                <SortableTask key={t.id} task={t} now={now} onOpen={onOpen} />
              ))}
            </SortableContext>
          </BoardColumn>
        ))}
      </div>
    </DndContext>
  );
}

function BoardColumn({ id, label, count, children }: { id: string; label: string; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section aria-label={`${label}, ${count} tarefa(s)`} className={cn("flex w-80 shrink-0 snap-start flex-col rounded-xl bg-muted/60", isOver && "ring-2 ring-ring")}>
      <h2 className="px-3 pt-3 pb-2 text-sm font-semibold">
        {label} <span className="tabular font-normal text-muted-foreground">({count})</span>
      </h2>
      <ul ref={setNodeRef} className="grid min-h-24 content-start gap-2 px-2 pb-3">
        {children}
      </ul>
    </section>
  );
}

function SortableTask({ task, now, onOpen }: { task: Task; now: number; onOpen: (t: Task) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && "opacity-40")} {...attributes} {...listeners}>
      <TaskItem task={task} now={now} onOpen={onOpen} />
    </div>
  );
}
