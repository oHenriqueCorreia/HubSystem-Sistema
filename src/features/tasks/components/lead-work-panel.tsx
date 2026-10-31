"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, ListPlus, Repeat, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime, todayLocal } from "@/domain/shared/dates";
import { cancelEnrollment, enrollLead } from "../actions";
import { TaskItem } from "./task-item";
import { TaskSheet } from "./task-sheet";
import { TaskFormDialog } from "./task-form-dialog";
import { EventDialog } from "./event-dialog";
import type { Task } from "../types";

type Owner = { id: string; full_name: string; email: string };

export function LeadWorkPanel({
  lead,
  tasks,
  events,
  enrollments,
  cadences,
  owners,
  meId,
  perms,
}: {
  lead: { id: string; name: string };
  tasks: Task[];
  events: { id: string; title: string; starts_at: string; ends_at: string; kind: string; all_day: boolean }[];
  enrollments: { id: string; status: string; started_at: string; template: { id: string; name: string } | null }[];
  cadences: { id: string; name: string; is_active: boolean }[];
  owners: Owner[];
  meId: string;
  perms: { createTask: boolean; assignTask: boolean; deleteTask: boolean; manageCalendar: boolean; assignCalendar: boolean };
}) {
  const router = useRouter();
  const [now] = useState(() => Date.now());
  const [selected, setSelected] = useState<Task | null>(null);
  const [eventOpen, setEventOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [template, setTemplate] = useState("");
  const [start, setStart] = useState(todayLocal());
  const [pending, startTransition] = useTransition();
  const open = tasks.filter((t) => t.status === "a_fazer" || t.status === "em_andamento");
  const closed = tasks.filter((t) => !open.includes(t)).slice(0, 5);
  const active = enrollments.filter((e) => e.status === "ativa");
  const current = selected ? (tasks.find((t) => t.id === selected.id) ?? selected) : null;

  return (
    <div className="grid gap-6">
      <section aria-labelledby="lead-tarefas" className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="lead-tarefas" className="text-sm font-semibold">
            Tarefas <span className="tabular font-normal text-muted-foreground">({open.length} em aberto)</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {perms.createTask && (
              <TaskFormDialog
                owners={owners}
                canAssign={perms.assignTask}
                defaults={{ lead }}
                trigger={
                  <Button size="sm" variant="outline">
                    <ListPlus aria-hidden="true" /> Nova tarefa
                  </Button>
                }
              />
            )}
            {perms.createTask && cadences.some((c) => c.is_active) && (
              <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Repeat aria-hidden="true" /> Iniciar cadência
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Iniciar cadência</DialogTitle>
                    <DialogDescription>As etapas viram tarefas com data e hora para {lead.name}.</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="cad-template">Cadência</Label>
                      <Select value={template} onValueChange={setTemplate}>
                        <SelectTrigger id="cad-template" className="w-full">
                          <SelectValue placeholder="Escolha a cadência" />
                        </SelectTrigger>
                        <SelectContent>
                          {cadences
                            .filter((c) => c.is_active)
                            .map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="cad-start">Começar em</Label>
                      <Input id="cad-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setEnrollOpen(false)}>
                      Cancelar
                    </Button>
                    <Button
                      disabled={!template || pending}
                      onClick={() =>
                        startTransition(async () => {
                          const res = await enrollLead({ leadId: lead.id, templateId: template, startDate: start || null });
                          if (!res.ok) return void toast.error(res.message);
                          toast.success(res.message);
                          setEnrollOpen(false);
                          router.refresh();
                        })
                      }
                    >
                      Iniciar cadência
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>
        {active.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {active.map((e) => (
              <li key={e.id}>
                <Badge variant="secondary" className="gap-1">
                  <Repeat className="size-3" aria-hidden="true" /> {e.template?.name}
                  <button
                    type="button"
                    className="ml-1 rounded hover:text-danger"
                    aria-label={`Cancelar cadência ${e.template?.name}`}
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const res = await cancelEnrollment({ id: e.id, leadId: lead.id });
                        if (res.ok) {
                          toast.success(res.message);
                          router.refresh();
                        } else toast.error(res.message);
                      })
                    }
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {open.length === 0 && closed.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma tarefa para este lead.</p>
        ) : (
          <ul className="grid gap-2">
            {[...open, ...closed].map((t) => (
              <TaskItem key={t.id} task={t} now={now} onOpen={setSelected} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="lead-reunioes" className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 id="lead-reunioes" className="text-sm font-semibold">
            Reuniões e compromissos
          </h2>
          {perms.manageCalendar && (
            <Button size="sm" variant="outline" onClick={() => setEventOpen(true)}>
              <CalendarPlus aria-hidden="true" /> Agendar reunião
            </Button>
          )}
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma reunião agendada.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 rounded-md border bg-surface px-3 py-2">
                <span className="truncate font-medium">{e.title}</span>
                <span className={`tabular text-xs ${new Date(e.ends_at).getTime() < now ? "text-muted-foreground" : ""}`}>{formatDateTime(e.starts_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <TaskSheet task={current} onClose={() => setSelected(null)} owners={owners} canAssign={perms.assignTask} canDelete={perms.deleteTask} />
      {eventOpen && (
        <EventDialog open onOpenChange={setEventOpen} draft={{ date: todayLocal(), time: "10:00", lead }} owners={owners} canAssign={perms.assignCalendar} meId={meId} />
      )}
    </div>
  );
}
