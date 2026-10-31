"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, CalendarClock, Flag, ListChecks, MessageCircle, Phone } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "cn";
import { formatDate, formatDateTime } from "@/domain/shared/dates";
import { whatsappLink, fillTemplate } from "@/domain/shared/phone";
import { setTaskStatus } from "../actions";
import { checklistProgress, isOverdue, PRIORITY_LABEL, type Task } from "../types";

const PRIORITY_STYLE: Record<Task["priority"], string> = {
  baixa: "text-muted-foreground",
  media: "text-info",
  alta: "text-warning",
  urgente: "text-danger",
};

export function TaskItem({ task, ownerName, onOpen, now, as = "li" }: { task: Task; ownerName?: string; onOpen?: (t: Task) => void; now: number; as?: "li" | "div" }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [optimisticDone, setOptimisticDone] = useOptimistic(task.status === "concluida");
  const overdue = !optimisticDone && isOverdue(task, new Date(now));
  const progress = checklistProgress(task.checklist);

  function toggle(done: boolean) {
    startTransition(async () => {
      setOptimisticDone(done);
      const res = await setTaskStatus({ id: task.id, status: done ? "concluida" : "a_fazer" });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      if (done) {
        toast.success("Tarefa concluída.", {
          action: {
            label: "Desfazer",
            onClick: async () => {
              const r = await setTaskStatus({ id: task.id, status: "a_fazer" });
              if (r.ok) router.refresh();
              else toast.error(r.message);
            },
          },
        });
      }
      router.refresh();
    });
  }

  const due = task.due_at ? (task.has_time ? formatDateTime(task.due_at) : formatDate(task.due_at)) : null;
  const Component = as;

  return (
    <Component className={cn("flex items-start gap-3 rounded-xl border bg-surface px-3 py-3 shadow-sm transition-shadow hover:shadow-md", overdue && "border-danger/40")}>
      <Checkbox
        checked={optimisticDone}
        onCheckedChange={(v) => toggle(Boolean(v))}
        aria-label={optimisticDone ? `Reabrir “${task.title}”` : `Concluir “${task.title}”`}
        className="mt-0.5 size-5 rounded-full"
      />
      <div className="grid min-w-0 flex-1 gap-1">
        <button
          type="button"
          onClick={() => onOpen?.(task)}
          className={cn("text-left text-sm font-medium hover:underline", optimisticDone && "text-muted-foreground line-through")}
        >
          {task.title}
        </button>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {due && (
            <span className={cn("inline-flex items-center gap-1", overdue && "font-medium text-danger")}>
              {overdue ? <AlarmClock className="size-3.5" aria-hidden="true" /> : <CalendarClock className="size-3.5" aria-hidden="true" />}
              {overdue ? `Atrasada · ${due}` : due}
            </span>
          )}
          {task.priority !== "media" && (
            <span className={cn("inline-flex items-center gap-1", PRIORITY_STYLE[task.priority])}>
              <Flag className="size-3.5" aria-hidden="true" /> {PRIORITY_LABEL[task.priority]}
            </span>
          )}
          {progress.total > 0 && (
            <span className="inline-flex items-center gap-1" aria-label={`Checklist: ${progress.done} de ${progress.total}`}>
              <ListChecks className="size-3.5" aria-hidden="true" />
              <span className="tabular">
                {progress.done}/{progress.total}
              </span>
              <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <span className="block h-full bg-primary" style={{ width: `${progress.pct}%` }} />
              </span>
            </span>
          )}
          {task.lead && (
            <Link href={`/crm/leads/${task.lead.id}`} className="truncate text-primary hover:underline">
              {task.lead.name}
            </Link>
          )}
          {ownerName && <span>{ownerName}</span>}
          {task.category && <span>{task.category}</span>}
        </div>
      </div>
      {!optimisticDone && task.channel === "whatsapp" && task.lead?.whatsapp_e164 && (
        <a
          href={whatsappLink(task.lead.whatsapp_e164, task.suggested_message ? fillTemplate(task.suggested_message, { nome: task.lead.name, empresa: task.lead.name }) : undefined)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border hover:bg-muted"
          aria-label={`Abrir WhatsApp de ${task.lead.name}`}
        >
          <MessageCircle className="size-4" aria-hidden="true" />
        </a>
      )}
      {!optimisticDone && task.channel === "ligacao" && task.lead?.whatsapp_e164 && (
        <a href={`tel:${task.lead.whatsapp_e164}`} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border hover:bg-muted" aria-label={`Ligar para ${task.lead.name}`}>
          <Phone className="size-4" aria-hidden="true" />
        </a>
      )}
    </Component>
  );
}
