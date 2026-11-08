"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatDateTime, formatRelative } from "@/domain/shared/dates";
import { addChecklistItem, addComment, deleteChecklistItem, deleteTask, restoreTask, setTaskStatus, toggleChecklistItem } from "../actions";
import { CHANNEL_LABEL, checklistProgress, PRIORITY_LABEL, STATUS_LABEL, type ChecklistItem, type Task, type TaskComment } from "../types";
import { TaskFormDialog } from "./task-form-dialog";
import { TaskHistory } from "./task-history";
import { TaskDeliveries } from "./task-deliveries";
import { TagChip } from "@/features/crm/components/chips";
import type { TagColor } from "@/features/crm/types";
import { getTaskDetails } from "../actions-read";
import { Attachments } from "@/features/clients/components/attachments";
import { ContentStatusBadge } from "@/features/content/components/content-status";

type Owner = { id: string; full_name: string; email: string };

export function TaskSheet({
  task,
  onClose,
  owners,
  canAssign,
  canDelete,
}: {
  task: Task | null;
  onClose: () => void;
  owners: Owner[];
  canAssign: boolean;
  canDelete: boolean;
}) {
  return (
    <Sheet open={Boolean(task)} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {task && <TaskDetails key={task.id} task={task} owners={owners} canAssign={canAssign} canDelete={canDelete} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function TaskDetails({ task, owners, canAssign, canDelete, onClose }: { task: Task; owners: Owner[]; canAssign: boolean; canDelete: boolean; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState<ChecklistItem[]>(task.checklist);
  const [newItem, setNewItem] = useState("");
  const [comments, setComments] = useState<TaskComment[] | null>(null);
  const [comment, setComment] = useState("");
  const [outcome, setOutcome] = useState(task.outcome ?? "");
  const [editOpen, setEditOpen] = useState(false);
  const names = new Map(owners.map((o) => [o.id, o.full_name || o.email]));
  const progress = checklistProgress(items);

  if (comments === null) {
    // Carrega comentários sob demanda (uma vez por abertura do painel).
    setComments([]);
    void getTaskDetails({ id: task.id }).then((r) => r.ok && setComments(r.data.comments));
  }

  function toggleItem(item: ChecklistItem, done: boolean) {
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, done_at: done ? new Date().toISOString() : null } : i)));
    startTransition(async () => {
      const res = await toggleChecklistItem({ id: item.id, done });
      if (!res.ok) {
        setItems((list) => list.map((i) => (i.id === item.id ? item : i)));
        toast.error(res.message);
      }
    });
  }

  function addItem() {
    const title = newItem.trim();
    if (!title) return;
    setNewItem("");
    startTransition(async () => {
      const res = await addChecklistItem({ taskId: task.id, title });
      if (res.ok) {
        setItems((l) => [...l, res.data]);
      } else toast.error(res.message);
    });
  }

  function status(s: Task["status"]) {
    startTransition(async () => {
      const res = await setTaskStatus({ id: task.id, status: s, outcome });
      if (res.ok) {
        toast.success(res.message);
      } else toast.error(res.message);
    });
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="pr-6">{task.title}</SheetTitle>
        <SheetDescription>
          {STATUS_LABEL[task.status]} · Prioridade {PRIORITY_LABEL[task.priority].toLowerCase()}
          {task.due_at && ` · Prazo ${task.has_time ? formatDateTime(task.due_at) : formatDate(task.due_at)}`}
        </SheetDescription>
      </SheetHeader>

      <div className="grid gap-6 px-4 pb-6">
        <div className="flex flex-wrap gap-2">
          {task.status !== "concluida" ? (
            <Button onClick={() => status("concluida")} disabled={pending}>
              Concluir tarefa
            </Button>
          ) : (
            <Button variant="outline" onClick={() => status("a_fazer")} disabled={pending}>
              Reabrir
            </Button>
          )}
          <TaskFormDialog
            task={task}
            owners={owners}
            canAssign={canAssign}
            open={editOpen}
            onOpenChange={setEditOpen}
            trigger={
              <Button variant="outline">
                <Pencil aria-hidden="true" /> Editar
              </Button>
            }
          />
          {canDelete && (
            <Button
              variant="ghost"
              className="text-danger"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await deleteTask({ id: task.id });
                  if (!res.ok) return void toast.error(res.message);
                  onClose();
                  toast.success("Tarefa excluída.", {
                    action: {
                      label: "Desfazer",
                      onClick: async () => {
                        const r = await restoreTask({ id: task.id });
                        if (!r.ok) toast.error(r.message);
                      },
                    },
                  });
                })
              }
            >
              <Trash2 aria-hidden="true" /> Excluir
            </Button>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Responsável</dt>
            <dd>{task.owner_id ? (names.get(task.owner_id) ?? "—") : "—"}</dd>
          </div>
          {task.list && (
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Quadro e lista</dt>
              <dd className="break-words">
                {task.list.board ? (
                  <Link href={`/tarefas?modo=quadro&quadro=${task.list.board.id}`} className="text-primary hover:underline">
                    {task.list.board.name}
                  </Link>
                ) : (
                  "Quadro"
                )}
                {` › ${task.list.name}`}
              </dd>
            </div>
          )}
          {task.content && (
            <div>
              <dt className="text-xs text-muted-foreground">Conteúdo</dt>
              <dd>
                <Link href={`/conteudo/${task.content.id}`} className="hover:underline">
                  <ContentStatusBadge status={task.content.status} />
                </Link>
              </dd>
            </div>
          )}
          {task.client && (
            <div>
              <dt className="text-xs text-muted-foreground">Cliente</dt>
              <dd className="break-words">
                <Link href={`/clientes/${task.client.id}`} className="text-primary hover:underline">
                  {task.client.legal_name}
                </Link>
              </dd>
            </div>
          )}
          {task.lead && (
            <div>
              <dt className="text-xs text-muted-foreground">Lead</dt>
              <dd>
                <Link href={`/crm/leads/${task.lead.id}`} className="text-primary hover:underline">
                  {task.lead.name}
                </Link>
              </dd>
            </div>
          )}
          {task.channel && (
            <div>
              <dt className="text-xs text-muted-foreground">Canal</dt>
              <dd>{CHANNEL_LABEL[task.channel]}</dd>
            </div>
          )}
          {task.category && (
            <div>
              <dt className="text-xs text-muted-foreground">Categoria</dt>
              <dd>{task.category}</dd>
            </div>
          )}
          {task.participant_ids.length > 0 && (
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Participantes</dt>
              <dd>{task.participant_ids.map((id) => names.get(id) ?? "Usuário").join(", ")}</dd>
            </div>
          )}
          {task.tags.length > 0 && (
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Etiquetas</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {task.tags.map((t) => (
                  <TagChip key={t.id} name={t.name} color={t.color as TagColor} />
                ))}
              </dd>
            </div>
          )}
        </dl>

        {task.description && <p className="text-sm whitespace-pre-wrap">{task.description}</p>}
        {task.suggested_message && (
          <div className="rounded-lg border bg-muted/50 p-3 text-sm">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Mensagem sugerida</p>
            <p className="whitespace-pre-wrap">{task.suggested_message}</p>
          </div>
        )}

        <TaskDeliveries task={task} owners={owners} />

        <section aria-labelledby="checklist-title" className="grid gap-2">
          <div className="flex items-center justify-between">
            <h3 id="checklist-title" className="text-sm font-semibold">
              Checklist
            </h3>
            {progress.total > 0 && (
              <span className="tabular text-xs text-muted-foreground">
                {progress.done} de {progress.total}
              </span>
            )}
          </div>
          {progress.total > 0 && <Progress value={progress.pct} aria-label={`Checklist ${progress.pct}% concluído`} />}
          <ul className="grid gap-1">
            {items.map((i) => (
              <li key={i.id} className="group flex min-h-9 items-center gap-2">
                <Checkbox id={`ci-${i.id}`} checked={Boolean(i.done_at)} onCheckedChange={(v) => toggleItem(i, Boolean(v))} />
                <label htmlFor={`ci-${i.id}`} className={`flex-1 text-sm ${i.done_at ? "text-muted-foreground line-through" : ""}`}>
                  {i.title}
                </label>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remover “${i.title}”`}
                  onClick={() =>
                    startTransition(async () => {
                      setItems((l) => l.filter((x) => x.id !== i.id));
                      const res = await deleteChecklistItem({ id: i.id });
                      if (!res.ok) {
                        toast.error(res.message);
                        setItems((l) => [...l, i]);
                      }
                    })
                  }
                >
                  <X aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addItem())}
              placeholder="Novo item…"
              aria-label="Novo item do checklist"
            />
            <Button variant="outline" onClick={addItem} disabled={!newItem.trim()}>
              <Plus aria-hidden="true" /> Adicionar
            </Button>
          </div>
        </section>

        {task.lead_id && task.status !== "concluida" && (
          <div className="grid gap-1.5">
            <Label htmlFor="outcome">Resultado (vai para a linha do tempo ao concluir)</Label>
            <Textarea id="outcome" rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Ex.: Pediu para retornar na sexta…" />
          </div>
        )}

        {canAssign && (
          <div className="grid gap-1.5">
            <Label htmlFor="task-status">Situação</Label>
            <Select value={task.status} onValueChange={(v) => status(v as Task["status"])}>
              <SelectTrigger id="task-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Attachments entityType="task" entityId={task.id} />

        <section aria-labelledby="comments-title" className="grid gap-3">
          <h3 id="comments-title" className="text-sm font-semibold">
            Comentários
          </h3>
          {comments && comments.length === 0 && <p className="text-sm text-muted-foreground">Nenhum comentário.</p>}
          <ul className="grid gap-3">
            {comments?.map((c) => (
              <li key={c.id} className="text-sm">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{names.get(c.author_id) ?? "Usuário"}</span> · {formatRelative(c.created_at)}
                </p>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </li>
            ))}
          </ul>
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!comment.trim()) return;
              const body = comment.trim();
              startTransition(async () => {
                const res = await addComment({ taskId: task.id, body });
                if (!res.ok) return void toast.error(res.message);
                setComment("");
                const r = await getTaskDetails({ id: task.id });
                if (r.ok) setComments(r.data.comments);
              });
            }}
          >
            <Label htmlFor="new-comment" className="sr-only">
              Novo comentário
            </Label>
            <Textarea id="new-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Escreva um comentário…" />
            <Button type="submit" variant="outline" className="justify-self-end" disabled={pending || !comment.trim()}>
              Comentar
            </Button>
          </form>
        </section>

        <TaskHistory key={task.id} taskId={task.id} />
      </div>
    </>
  );
}
