"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { ChevronDown, LoaderCircle, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormAlert, FormField } from "@/components/app/form-field";
import { LeadPicker, type LeadOption } from "@/features/crm/components/lead-picker";
import { dayKey, minutesOfDay } from "@/domain/calendar";
import { createTask, updateTask } from "../actions";
import { taskFormSchema } from "../schemas";
import { CHANNEL_LABEL, PRIORITY_LABEL, STATUS_LABEL, type Task } from "../types";
import type { z } from "zod";

type Owner = { id: string; full_name: string; email: string };
type FormValues = Omit<z.input<typeof taskFormSchema>, "checklist"> & { checklistItems: { title: string }[] };
const NONE = "__nenhum__";

function timeOf(iso: string) {
  const m = minutesOfDay(iso);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function TaskFormDialog({
  trigger,
  task,
  owners,
  canAssign,
  defaults,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: ReactNode;
  task?: Task;
  owners: Owner[];
  canAssign: boolean;
  defaults?: { lead?: LeadOption | null; dueDate?: string; dueTime?: string };
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const router = useRouter();
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = onOpenChange ?? setInnerOpen;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lead, setLead] = useState<LeadOption | null>(task?.lead ? { id: task.lead.id, name: task.lead.name } : (defaults?.lead ?? null));

  const form = useForm<FormValues>({
    defaultValues: {
      title: task?.title ?? "",
      description: task?.description ?? "",
      ownerId: task?.owner_id ?? null,
      priority: task?.priority ?? "media",
      status: task?.status ?? "a_fazer",
      startDate: task?.start_date ?? null,
      dueDate: task?.due_at ? dayKey(task.due_at) : (defaults?.dueDate ?? null),
      dueTime: task?.due_at && task.has_time ? timeOf(task.due_at) : (defaults?.dueTime ?? null),
      durationMinutes: task?.duration_minutes ?? 30,
      category: task?.category ?? "",
      channel: task?.channel ?? null,
      checklistItems: [],
    },
  });
  const checklist = useFieldArray({ control: form.control, name: "checklistItems" });
  const [newItem, setNewItem] = useState("");

  const onSubmit = form.handleSubmit((values) => {
    setError(null);
    const { checklistItems, ...rest } = values;
    const payload = { ...rest, leadId: lead?.id ?? null, checklist: checklistItems.map((c) => c.title) };
    const parsed = taskFormSchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) form.setError(issue.path.join(".") as keyof FormValues, { message: issue.message });
      return;
    }
    startTransition(async () => {
      const res = task ? await updateTask({ ...payload, id: task.id }) : await createTask(payload);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      toast.success(res.message);
      setOpen(false);
      if (!task) form.reset();
      router.refresh();
    });
  });

  const { errors } = form.formState;

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{task ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
          <DialogDescription>Com data e hora, a tarefa também aparece na agenda.</DialogDescription>
        </DialogHeader>
        <form id="task-form" onSubmit={onSubmit} noValidate className="grid gap-4">
          <FormAlert>{error}</FormAlert>
          <FormField label="Título" error={errors.title?.message} required>
            <Input autoFocus {...form.register("title", { required: "Informe o título." })} />
          </FormField>

          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Prazo" error={errors.dueDate?.message} optional>
              <Input type="date" {...form.register("dueDate", { setValueAs: (v) => v || null })} />
            </FormField>
            <FormField label="Horário" error={errors.dueTime?.message} optional>
              <Input type="time" {...form.register("dueTime", { setValueAs: (v) => v || null })} />
            </FormField>
            <FormField label="Prioridade">
              <Controller
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
          </div>

          <FormField label="Lead relacionado" optional>
            <LeadPicker value={lead} onChange={setLead} />
          </FormField>

          {canAssign && (
            <FormField label="Responsável">
              <Controller
                control={form.control}
                name="ownerId"
                render={({ field }) => (
                  <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Eu mesmo</SelectItem>
                      {owners.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.full_name || o.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
          )}

          <FormField label="Descrição" optional>
            <Textarea rows={3} {...form.register("description")} />
          </FormField>

          {!task && (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Checklist (opcional)</legend>
              <ul className="grid gap-1">
                {checklist.fields.map((f, i) => (
                  <li key={f.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">• {f.title}</span>
                    <Button type="button" variant="ghost" size="icon-xs" onClick={() => checklist.remove(i)} aria-label={`Remover “${f.title}”`}>
                      <X aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  placeholder="Adicionar item…"
                  aria-label="Novo item do checklist"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (newItem.trim()) checklist.append({ title: newItem.trim() });
                      setNewItem("");
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (newItem.trim()) checklist.append({ title: newItem.trim() });
                    setNewItem("");
                  }}
                >
                  <Plus aria-hidden="true" /> Adicionar
                </Button>
              </div>
            </fieldset>
          )}

          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" className="group -ml-2 justify-start">
                <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" /> Mais opções
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 grid gap-3 sm:grid-cols-2">
              <FormField label="Início" error={errors.startDate?.message} optional>
                <Input type="date" {...form.register("startDate", { setValueAs: (v) => v || null })} />
              </FormField>
              <FormField label="Duração (min)" optional>
                <Input type="number" min={5} max={1440} step={5} {...form.register("durationMinutes", { setValueAs: (v) => (v === "" ? null : Number(v)) })} />
              </FormField>
              <FormField label="Situação">
                <Controller
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
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
                  )}
                />
              </FormField>
              <FormField label="Canal de contato" optional>
                <Controller
                  control={form.control}
                  name="channel"
                  render={({ field }) => (
                    <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Nenhum</SelectItem>
                        {Object.entries(CHANNEL_LABEL).map(([k, v]) => (
                          <SelectItem key={k} value={k}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
              <FormField label="Categoria" optional className="sm:col-span-2">
                <Input placeholder="Ex.: Produção de site, Financeiro, Suporte…" {...form.register("category")} />
              </FormField>
            </CollapsibleContent>
          </Collapsible>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form="task-form" disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {task ? "Salvar tarefa" : "Criar tarefa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
