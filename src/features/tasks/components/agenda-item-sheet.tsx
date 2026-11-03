"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, CalendarDays, CalendarX2, Flag, ListChecks, LoaderCircle, Pencil, Send, Users, Video } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormField } from "@/components/app/form-field";
import { dayKey, minutesOfDay } from "@/domain/calendar";
import { AGENDA_TYPE_LABEL, statusGroup, type AgendaEntry, type AgendaType } from "@/domain/calendar/agenda";
import { cancelAgendaItem, rescheduleAgendaItem } from "../actions";
import { getEventDetails } from "../actions-read";
import { EventDialog } from "./event-dialog";
import type { CalendarEvent } from "../queries";

type Owner = { id: string; full_name: string; email: string };

/** Cor, ícone e nome juntos: o tipo nunca depende só da cor. */
export const AGENDA_STYLE: Record<AgendaType, { icon: typeof Users; className: string }> = {
  reuniao: { icon: Users, className: "bg-accent text-accent-foreground border-primary/30" },
  compromisso: { icon: CalendarDays, className: "bg-success-soft text-success border-success/30" },
  bloqueio: { icon: Ban, className: "bg-muted text-muted-foreground border-border" },
  tarefa: { icon: ListChecks, className: "bg-info-soft text-info border-info/30" },
  prazo: { icon: Flag, className: "bg-warning-soft text-warning border-warning/30" },
  publicacao: { icon: Send, className: "bg-signal-soft text-signal border-signal/30" },
};

const hhmm = (iso: string) => {
  const m = minutesOfDay(iso);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export const agendaTime = (e: Pick<AgendaEntry, "allDay" | "start" | "end" | "type">) => (e.allDay ? (e.type === "prazo" ? "Até o fim do dia" : "Dia inteiro") : `${hhmm(e.start)}–${hhmm(e.end)}`);

const longDate = (iso: string) => new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date(iso));

/** Detalhes de qualquer item da agenda, com as ações que a pessoa pode usar. */
export function AgendaItemSheet({
  entry,
  onClose,
  onChanged,
  owners,
  meId,
  canManageEvents,
  canAssignEvents,
  canEditTasks,
}: {
  entry: AgendaEntry | null;
  onClose: () => void;
  onChanged?: () => void;
  owners: Owner[];
  meId: string;
  canManageEvents: boolean;
  canAssignEvents: boolean;
  canEditTasks: boolean;
}) {
  return (
    <Sheet open={Boolean(entry)} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {entry && <Details key={entry.id} entry={entry} onClose={onClose} onChanged={onChanged} owners={owners} meId={meId} canManageEvents={canManageEvents} canAssignEvents={canAssignEvents} canEditTasks={canEditTasks} />}
      </SheetContent>
    </Sheet>
  );
}

function Details({ entry, onClose, onChanged, owners, meId, canManageEvents, canAssignEvents, canEditTasks }: { entry: AgendaEntry; onClose: () => void; onChanged?: () => void; owners: Owner[]; meId: string; canManageEvents: boolean; canAssignEvents: boolean; canEditTasks: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rescheduling, setRescheduling] = useState(false);
  const [date, setDate] = useState(dayKey(entry.start));
  const [time, setTime] = useState(entry.allDay ? "" : hhmm(entry.start));
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const style = AGENDA_STYLE[entry.type];
  const owner = owners.find((o) => o.id === entry.ownerId);
  const closed = statusGroup(entry) !== "aberto";
  const canChange = entry.source === "evento" ? canManageEvents : entry.source === "tarefa" ? canEditTasks : false;

  function finish(message?: string) {
    if (message) toast.success(message);
    onChanged?.();
    router.refresh();
    onClose();
  }

  function reschedule() {
    startTransition(async () => {
      const res = await rescheduleAgendaItem({ source: entry.source, id: entry.id, date, time: time || null });
      if (!res.ok) return void toast.error(res.message);
      finish(res.message);
    });
  }

  function edit() {
    startTransition(async () => {
      const res = await getEventDetails({ id: entry.id });
      if (res.ok) setEditing(res.data);
      else toast.error(res.message);
    });
  }

  return (
    <>
      <SheetHeader>
        <p className={cn("inline-flex w-fit items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium", style.className)}>
          <style.icon className="size-3.5" aria-hidden="true" /> {AGENDA_TYPE_LABEL[entry.type]}
        </p>
        <SheetTitle className="pr-6 break-words">{entry.title}</SheetTitle>
        <SheetDescription>
          <span className="first-letter:uppercase">{longDate(entry.start)}</span>, {agendaTime(entry)}
        </SheetDescription>
      </SheetHeader>
      <div className="grid gap-5 px-4 pb-6">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Situação</dt>
            <dd>{entry.statusLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Responsável</dt>
            <dd className="break-words">{owner ? owner.full_name || owner.email : "Sem responsável"}</dd>
          </div>
          {entry.clientName && (
            <div>
              <dt className="text-xs text-muted-foreground">Cliente</dt>
              <dd className="break-words">
                <Link href={`/clientes/${entry.clientId}`} className="text-primary hover:underline">
                  {entry.clientName}
                </Link>
              </dd>
            </div>
          )}
          {entry.leadName && (
            <div>
              <dt className="text-xs text-muted-foreground">Lead</dt>
              <dd className="break-words">
                <Link href={`/crm/leads/${entry.leadId}`} className="text-primary hover:underline">
                  {entry.leadName}
                </Link>
              </dd>
            </div>
          )}
          {entry.boardName && (
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Quadro e lista</dt>
              <dd className="break-words">
                <Link href={`/tarefas?modo=quadro&quadro=${entry.boardId}`} className="text-primary hover:underline">
                  {entry.boardName}
                </Link>
                {entry.listName && ` › ${entry.listName}`}
              </dd>
            </div>
          )}
          {entry.location && (
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Local</dt>
              <dd className="break-words">{entry.location}</dd>
            </div>
          )}
        </dl>
        {entry.description && <p className="text-sm break-words whitespace-pre-wrap">{entry.description}</p>}

        <div className="flex flex-wrap gap-2">
          {entry.meetUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={entry.meetUrl} target="_blank" rel="noreferrer">
                <Video aria-hidden="true" /> Entrar na chamada
              </a>
            </Button>
          )}
          {entry.taskId && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/tarefas?tarefa=${entry.taskId}`}>
                <ListChecks aria-hidden="true" /> Abrir tarefa
              </Link>
            </Button>
          )}
          {entry.source === "evento" && canManageEvents && (
            <Button variant="outline" size="sm" disabled={pending} onClick={edit}>
              <Pencil aria-hidden="true" /> Editar
            </Button>
          )}
          {canChange && !closed && (
            <Button variant="outline" size="sm" aria-expanded={rescheduling} onClick={() => setRescheduling((v) => !v)}>
              <CalendarDays aria-hidden="true" /> Reagendar
            </Button>
          )}
          {canChange && !closed && (
            <ConfirmDialog
              tone="danger"
              trigger={
                <Button variant="ghost" size="sm" className="text-danger">
                  <CalendarX2 aria-hidden="true" /> Cancelar
                </Button>
              }
              title="Cancelar este item?"
              description="Ele continua registrado como cancelado e sai das visões normais. Para vê-lo, filtre por cancelados."
              confirmLabel="Cancelar item"
              onConfirm={async () => {
                const res = await cancelAgendaItem({ source: entry.source, id: entry.id });
                if (!res.ok) return void toast.error(res.message);
                finish(res.message);
              }}
            />
          )}
        </div>

        {rescheduling && (
          <form
            className="grid gap-3 rounded-lg border bg-muted/30 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              reschedule();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Nova data" required>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </FormField>
              <FormField label="Horário" optional={entry.source === "tarefa"}>
                <Input type="time" value={time} disabled={entry.source === "evento" && entry.allDay} onChange={(e) => setTime(e.target.value)} />
              </FormField>
            </div>
            <Button type="submit" size="sm" className="justify-self-start" disabled={pending || !date}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar nova data
            </Button>
          </form>
        )}
      </div>
      {editing && (
        <EventDialog
          open
          onOpenChange={(v) => {
            if (!v) {
              setEditing(null);
              onChanged?.();
            }
          }}
          event={editing}
          owners={owners}
          canAssign={canAssignEvents}
          meId={meId}
        />
      )}
    </>
  );
}
