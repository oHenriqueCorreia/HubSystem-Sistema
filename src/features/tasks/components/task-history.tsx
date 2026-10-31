"use client";

import { useState, useTransition } from "react";
import { History, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/domain/shared/dates";
import { getTaskHistory, type TaskHistoryEntry } from "../actions";

const FIELD: Record<string, string> = {
  title: "título",
  owner_id: "responsável",
  status: "situação",
  column_id: "coluna",
  priority: "prioridade",
  due_at: "prazo",
  deleted_at: "exclusão",
};

const ACTION: Record<string, string> = {
  insert: "criou a tarefa",
  update: "alterou",
  soft_delete: "moveu para a lixeira",
  restore: "restaurou",
  delete: "excluiu",
};

function describe(e: TaskHistoryEntry) {
  if (e.action !== "update") return ACTION[e.action] ?? e.action;
  const fields = Object.keys(e.changes ?? {}).map((k) => FIELD[k] ?? k);
  return fields.length ? `alterou ${fields.join(", ")}` : "alterou";
}

/** Linha do tempo da tarefa (a partir da auditoria), carregada sob demanda. */
export function TaskHistory({ taskId }: { taskId: string }) {
  const [items, setItems] = useState<TaskHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function load() {
    startTransition(async () => {
      const res = await getTaskHistory({ id: taskId });
      if (res.ok) setItems(res.data as TaskHistoryEntry[]);
      else setError(res.message);
    });
  }

  return (
    <section aria-labelledby="history-title" className="grid gap-2">
      <h3 id="history-title" className="text-sm font-semibold">
        Histórico
      </h3>
      {items === null ? (
        <Button variant="outline" size="sm" className="justify-self-start" onClick={load} disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <History aria-hidden="true" />} Ver histórico
        </Button>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem alterações registradas.</p>
      ) : (
        <ol className="grid gap-2 border-l pl-3">
          {items.map((e, i) => (
            <li key={i} className="text-sm">
              <span className="font-medium">{e.actor_name}</span> {describe(e)}
              <span className="block text-xs text-muted-foreground">{formatDateTime(e.created_at)}</span>
            </li>
          ))}
        </ol>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
