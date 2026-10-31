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
import { Archive, ArrowLeft, ArrowRight, LoaderCircle, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormAlert, FormField } from "@/components/app/form-field";
import { STAGE_DOT, TAG_COLOR_LABEL } from "@/features/crm/components/chips";
import type { TagColor } from "@/features/crm/types";
import { TAG_COLORS } from "@/features/tags/schemas";
import { cn } from "cn";
import { dayKey } from "@/domain/calendar";
import { todayLocal } from "@/domain/shared/dates";
import { positionBetween } from "@/features/crm/types";
import { archiveTaskColumn, createTaskColumn, deleteTaskColumn, moveTask, moveTaskColumn, updateTaskColumn } from "../actions";
import { STATUS_LABEL, type Task, type TaskColumn, type TaskStatus } from "../types";
import { TaskItem } from "./task-item";
import { TaskSheet } from "./task-sheet";
import { TaskFormDialog } from "./task-form-dialog";

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
  canCreate,
  canConfigure = false,
  columns = [],
  mode,
}: {
  tasks: Task[];
  owners: Owner[];
  canAssign: boolean;
  canDelete: boolean;
  canCreate: boolean;
  canConfigure?: boolean;
  columns?: TaskColumn[];
  mode: "lista" | "quadro";
}) {
  const [now] = useState(() => Date.now());
  const [open, setOpen] = useState<Task | null>(null);
  // Listas longas carregam aos poucos (50 por grupo) para manter a tela leve.
  const [limits, setLimits] = useState<Record<string, number>>({});
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
                {g.items.slice(0, limits[g.key] ?? 50).map((t) => (
                  <TaskItem key={t.id} task={t} now={now} ownerName={canAssign && t.owner_id ? names.get(t.owner_id) : undefined} onOpen={setOpen} />
                ))}
              </ul>
              {g.items.length > (limits[g.key] ?? 50) && (
                <button type="button" className="justify-self-start text-sm text-primary hover:underline" onClick={() => setLimits((l) => ({ ...l, [g.key]: (l[g.key] ?? 50) + 50 }))}>
                  Mostrar mais {Math.min(50, g.items.length - (limits[g.key] ?? 50))} de {g.items.length - (limits[g.key] ?? 50)}
                </button>
              )}
            </section>
          ))}
        </div>
      ) : (
        <TaskBoard tasks={tasks} columns={columns} now={now} onOpen={setOpen} owners={owners} canAssign={canAssign} canCreate={canCreate} canConfigure={canConfigure} />
      )}
      <TaskSheet task={openTask} onClose={() => setOpen(null)} owners={owners} canAssign={canAssign} canDelete={canDelete} />
    </>
  );
}

function TaskBoard({
  tasks,
  columns,
  now,
  onOpen,
  owners,
  canAssign,
  canCreate,
  canConfigure,
}: {
  tasks: Task[];
  columns: TaskColumn[];
  now: number;
  onOpen: (t: Task) => void;
  owners: Owner[];
  canAssign: boolean;
  canCreate: boolean;
  canConfigure: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const initial = () => {
    const firstOfKind = new Map<string, string>();
    for (const c of columns) if (!firstOfKind.has(c.kind)) firstOfKind.set(c.kind, c.id);
    const out: Record<string, Task[]> = Object.fromEntries(columns.map((c) => [c.id, []]));
    for (const t of tasks) {
      const col = t.column_id && out[t.column_id] ? t.column_id : firstOfKind.get(t.status);
      if (col) out[col].push(t);
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.position - b.position);
    return out;
  };
  const [cols, setCols] = useState(initial);
  const [source, setSource] = useState({ tasks, columns });
  if (source.tasks !== tasks || source.columns !== columns) {
    setSource({ tasks, columns });
    setCols(initial());
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function columnOf(id: string): string | undefined {
    if (cols[id]) return id;
    return Object.keys(cols).find((c) => cols[c].some((t) => t.id === id));
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
    const target = columns.find((c) => c.id === to)!;
    dest.splice(index, 0, { ...card, column_id: to, status: target.kind, position });
    setCols({ ...cols, [from]: cols[from].filter((t) => t.id !== card.id), [to]: dest });
    startTransition(async () => {
      const res = await moveTask({ id: card.id, columnId: to, position });
      if (!res.ok) {
        setCols(before);
        toast.error(res.message);
      } else {
        if (from !== to) toast.success(`Tarefa movida para ${target.name}.`);
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
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-4 pb-4 sm:-mx-6 sm:snap-none sm:px-6">
        {columns.map((c, i) => (
          <BoardColumn key={c.id} column={c} count={cols[c.id]?.length ?? 0} columns={columns} index={i} canConfigure={canConfigure}>
            <SortableContext items={(cols[c.id] ?? []).map((t) => t.id)} strategy={verticalListSortingStrategy}>
              {(cols[c.id] ?? []).map((t) => (
                <SortableTask key={t.id} task={t} now={now} onOpen={onOpen} />
              ))}
            </SortableContext>
            {canCreate && c.kind !== "cancelada" && (
              <li className="list-none">
                <TaskFormDialog
                  owners={owners}
                  canAssign={canAssign}
                  defaults={{ status: c.kind, columnId: c.id }}
                  trigger={
                    <button
                      type="button"
                      className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:bg-accent hover:text-accent-foreground"
                    >
                      <Plus className="size-4" aria-hidden="true" /> Adicionar tarefa
                    </button>
                  }
                />
              </li>
            )}
          </BoardColumn>
        ))}
        {canConfigure && <ColumnFormDialog />}
      </div>
    </DndContext>
  );
}

const KIND_OPTIONS: TaskStatus[] = ["a_fazer", "em_andamento", "concluida", "cancelada"];

function BoardColumn({
  column,
  count,
  columns,
  index,
  canConfigure,
  children,
}: {
  column: TaskColumn;
  count: number;
  columns: TaskColumn[];
  index: number;
  canConfigure: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  function move(dir: -1 | 1) {
    const neighbor = columns[index + dir];
    const beyond = columns[index + dir * 2];
    if (!neighbor) return;
    const position = dir < 0 ? positionBetween(beyond?.position ?? null, neighbor.position) : positionBetween(neighbor.position, beyond?.position ?? null);
    startTransition(async () => {
      const res = await moveTaskColumn({ id: column.id, position });
      if (!res.ok) toast.error(res.message);
      router.refresh();
    });
  }

  function archive() {
    startTransition(async () => {
      const res = await archiveTaskColumn({ id: column.id });
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
      router.refresh();
    });
  }

  return (
    <section
      aria-label={`${column.name}, ${count} tarefa(s)`}
      className={cn("flex max-h-[calc(100dvh-14rem)] w-[min(20rem,85vw)] shrink-0 snap-start flex-col rounded-2xl border bg-muted/40", isOver && "ring-2 ring-ring")}
    >
      <header className="flex items-center gap-2 px-4 pt-3 pb-2">
        <span className={cn("size-2.5 shrink-0 rounded-full", STAGE_DOT[column.color as TagColor] ?? STAGE_DOT.slate)} aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {column.name} <span className="tabular font-normal text-muted-foreground">({count})</span>
        </h2>
        {canConfigure && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" disabled={pending} aria-label={`Opções da coluna ${column.name}`}>
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <Pencil aria-hidden="true" /> Editar coluna
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === 0} onSelect={() => move(-1)}>
                <ArrowLeft aria-hidden="true" /> Mover para a esquerda
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === columns.length - 1} onSelect={() => move(1)}>
                <ArrowRight aria-hidden="true" /> Mover para a direita
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={count > 0} onSelect={archive}>
                <Archive aria-hidden="true" /> Arquivar coluna
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                <Trash2 aria-hidden="true" /> Excluir coluna
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>
      <ul ref={setNodeRef} className="grid min-h-28 flex-1 content-start gap-2 overflow-y-auto overscroll-y-contain px-2 pb-3">
        {children}
      </ul>
      {editing && <ColumnFormDialog column={column} open onOpenChange={setEditing} />}
      {deleting && <DeleteColumnDialog column={column} count={count} columns={columns} onClose={() => setDeleting(false)} />}
    </section>
  );
}

function ColumnFormDialog({ column, open: controlled, onOpenChange }: { column?: TaskColumn; open?: boolean; onOpenChange?: (v: boolean) => void }) {
  const router = useRouter();
  const [inner, setInner] = useState(false);
  const open = controlled ?? inner;
  const setOpen = onOpenChange ?? setInner;
  const [name, setName] = useState(column?.name ?? "");
  const [color, setColor] = useState<TagColor>((column?.color as TagColor) ?? "slate");
  const [kind, setKind] = useState<TaskStatus>(column?.kind ?? "em_andamento");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = column ? await updateTaskColumn({ id: column.id, name, color, kind }) : await createTaskColumn({ name, color, kind });
      if (!res.ok) {
        setError(res.fieldErrors?.name?.[0] ?? res.message);
        return;
      }
      toast.success(res.message);
      setOpen(false);
      if (!column) setName("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      {!column && (
        <DialogTrigger asChild>
          <button
            type="button"
            className="flex h-12 w-[min(20rem,85vw)] shrink-0 snap-start items-center justify-center gap-2 rounded-2xl border border-dashed text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            <Plus className="size-4" aria-hidden="true" /> Nova coluna
          </button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{column ? "Editar coluna" : "Nova coluna"}</DialogTitle>
          <DialogDescription>O status define como as tarefas da coluna contam nos relatórios (por exemplo, atrasadas e concluídas).</DialogDescription>
        </DialogHeader>
        <form id="column-form" onSubmit={submit} className="grid gap-3" noValidate>
          <FormAlert>{error}</FormAlert>
          <FormField label="Nome" required>
            <Input autoFocus autoComplete="off" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Em revisão, Aguardando cliente…" />
          </FormField>
          <FormField label="Status das tarefas nesta coluna">
            <Select value={kind} onValueChange={(v) => setKind(v as TaskStatus)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {STATUS_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Cor</legend>
            <div role="radiogroup" aria-label="Cor da coluna" className="flex flex-wrap gap-2">
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={TAG_COLOR_LABEL[c]}
                  onClick={() => setColor(c)}
                  className={cn("flex size-8 items-center justify-center rounded-full border", color === c && "ring-2 ring-ring ring-offset-2 ring-offset-background")}
                >
                  <span className={cn("size-4 rounded-full", STAGE_DOT[c])} />
                </button>
              ))}
            </div>
          </fieldset>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form="column-form" disabled={pending || !name.trim()}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} {column ? "Salvar coluna" : "Criar coluna"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ARCHIVE = "__arquivar__";

function DeleteColumnDialog({ column, count, columns, onClose }: { column: TaskColumn; count: number; columns: TaskColumn[]; onClose: () => void }) {
  const router = useRouter();
  const others = columns.filter((c) => c.id !== column.id);
  const [choice, setChoice] = useState<string>(others.find((c) => c.kind === column.kind)?.id ?? others[0]?.id ?? ARCHIVE);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await deleteTaskColumn({
        id: column.id,
        targetId: count && choice !== ARCHIVE ? choice : null,
        archiveTasks: Boolean(count) && choice === ARCHIVE,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(res.message);
      onClose();
      router.refresh();
    });
  }

  return (
    <AlertDialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir a coluna “{column.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {count ? `Ela tem ${count} tarefa(s). Escolha para onde elas vão antes de excluir.` : "A coluna está vazia. Esta ação fica registrada na auditoria."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {count > 0 && (
          <RadioGroup value={choice} onValueChange={setChoice} className="grid max-h-64 gap-2 overflow-y-auto">
            {others.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm">
                <RadioGroupItem value={c.id} /> Transferir para “{c.name}”
                <span className="text-xs text-muted-foreground">({STATUS_LABEL[c.kind]})</span>
              </label>
            ))}
            <label className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm">
              <RadioGroupItem value={ARCHIVE} /> Arquivar as tarefas (vão para a lixeira e podem ser restauradas)
            </label>
          </RadioGroup>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Excluir coluna
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SortableTask({ task, now, onOpen }: { task: Task; now: number; onOpen: (t: Task) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("list-none", isDragging && "opacity-40")} {...attributes} {...listeners}>
      <TaskItem task={task} now={now} onOpen={onOpen} as="div" />
    </li>
  );
}
