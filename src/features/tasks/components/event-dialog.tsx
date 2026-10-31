"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { LoaderCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormAlert, FormField } from "@/components/app/form-field";
import { LeadPicker, type LeadOption } from "@/features/crm/components/lead-picker";
import { dayKey, minutesOfDay } from "@/domain/calendar";
import { createEvent, deleteEvent, restoreEvent, updateEvent } from "../actions";
import { eventFormSchema, type EventFormValues } from "../schemas";
import type { CalendarEvent } from "../queries";

type Owner = { id: string; full_name: string; email: string };
const NONE = "__nenhum__";

function hhmm(iso: string) {
  const m = minutesOfDay(iso);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function plus30(time: string) {
  const [h, m] = time.split(":").map(Number);
  const t = Math.min(h * 60 + m + 60, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export type EventDraft = { date: string; time?: string; lead?: LeadOption | null };

export function EventDialog({
  open,
  onOpenChange,
  event,
  draft,
  owners,
  canAssign,
  meId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  event?: CalendarEvent | null;
  draft?: EventDraft | null;
  owners: Owner[];
  canAssign: boolean;
  meId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lead, setLead] = useState<LeadOption | null>(event?.lead ?? draft?.lead ?? null);
  const start = draft?.time ?? "09:00";

  const form = useForm<EventFormValues>({
    defaultValues: event
      ? {
          title: event.title,
          description: event.description ?? "",
          kind: event.kind,
          date: dayKey(event.starts_at),
          startTime: hhmm(event.starts_at),
          endTime: hhmm(event.ends_at),
          allDay: event.all_day,
          location: event.location ?? "",
          meetUrl: event.meet_url ?? "",
          ownerId: event.owner_id,
          attendeeIds: event.attendees,
          reminderMinutes: event.reminder_minutes[0] ?? null,
        }
      : {
          title: "",
          description: "",
          kind: "reuniao",
          date: draft?.date ?? dayKey(new Date()),
          startTime: start,
          endTime: plus30(start),
          allDay: false,
          location: "",
          meetUrl: "",
          ownerId: null,
          attendeeIds: [],
          reminderMinutes: 30,
        },
  });
  const allDay = useWatch({ control: form.control, name: "allDay" });
  const { errors } = form.formState;

  const submit = form.handleSubmit((values) => {
    setError(null);
    const payload = { ...values, leadId: lead?.id ?? null };
    const parsed = eventFormSchema.safeParse(payload);
    if (!parsed.success) {
      for (const i of parsed.error.issues) form.setError(i.path.join(".") as keyof EventFormValues, { message: i.message });
      return;
    }
    startTransition(async () => {
      const res = event ? await updateEvent({ ...payload, id: event.id }) : await createEvent(payload);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      toast.success(res.message);
      onOpenChange(false);
      router.refresh();
    });
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{event ? "Editar evento" : "Novo evento"}</DialogTitle>
          <DialogDescription>Horários no fuso de São Paulo.</DialogDescription>
        </DialogHeader>
        <form id="event-form" onSubmit={submit} noValidate className="grid gap-4">
          <FormAlert>{error}</FormAlert>
          <FormField label="Título" error={errors.title?.message} required>
            <Input autoFocus placeholder="Ex.: Apresentação do site…" {...form.register("title")} />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <FormField label="Tipo">
              <Controller
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="reuniao">Reunião</SelectItem>
                      <SelectItem value="compromisso">Compromisso</SelectItem>
                      <SelectItem value="bloqueio">Bloqueio de agenda</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <Controller control={form.control} name="allDay" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
              Dia inteiro
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Data" error={errors.date?.message} required>
              <Input type="date" {...form.register("date")} />
            </FormField>
            {!allDay && (
              <>
                <FormField label="Início" error={errors.startTime?.message}>
                  <Input type="time" {...form.register("startTime")} />
                </FormField>
                <FormField label="Fim" error={errors.endTime?.message}>
                  <Input type="time" {...form.register("endTime")} />
                </FormField>
              </>
            )}
          </div>
          <FormField label="Lead relacionado" optional>
            <LeadPicker value={lead} onChange={setLead} />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Local" optional>
              <Input {...form.register("location")} />
            </FormField>
            <FormField label="Link da chamada" optional>
              <Input type="url" placeholder="https://meet.google.com/…" {...form.register("meetUrl")} />
            </FormField>
          </div>
          <FormField label="Lembrete">
            <Controller
              control={form.control}
              name="reminderMinutes"
              render={({ field }) => (
                <Select value={field.value == null ? NONE : String(field.value)} onValueChange={(v) => field.onChange(v === NONE ? null : Number(v))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem lembrete</SelectItem>
                    <SelectItem value="10">10 minutos antes</SelectItem>
                    <SelectItem value="30">30 minutos antes</SelectItem>
                    <SelectItem value="60">1 hora antes</SelectItem>
                    <SelectItem value="1440">1 dia antes</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
          {canAssign && (
            <FormField label="Agenda de">
              <Controller
                control={form.control}
                name="ownerId"
                render={({ field }) => (
                  <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Minha agenda</SelectItem>
                      {owners
                        .filter((o) => o.id !== meId)
                        .map((o) => (
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
          {owners.length > 1 && (
            <fieldset className="grid gap-1">
              <legend className="mb-1 text-sm font-medium">Participantes da equipe</legend>
              <Controller
                control={form.control}
                name="attendeeIds"
                render={({ field }) => (
                  <div className="grid max-h-40 gap-1 overflow-y-auto">
                    {owners
                      .filter((o) => o.id !== meId)
                      .map((o) => (
                        <label key={o.id} className="flex min-h-8 items-center gap-2 text-sm">
                          <Checkbox
                            checked={field.value?.includes(o.id) ?? false}
                            onCheckedChange={(v) => field.onChange(v ? [...(field.value ?? []), o.id] : (field.value ?? []).filter((x) => x !== o.id))}
                          />
                          {o.full_name || o.email}
                        </label>
                      ))}
                  </div>
                )}
              />
            </fieldset>
          )}
          <FormField label="Descrição" optional>
            <Textarea rows={3} {...form.register("description")} />
          </FormField>
        </form>
        <DialogFooter className="sm:justify-between">
          {event ? (
            <Button
              variant="ghost"
              className="text-danger"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await deleteEvent({ id: event.id });
                  if (!res.ok) return void toast.error(res.message);
                  onOpenChange(false);
                  router.refresh();
                  toast.success("Evento excluído.", {
                    action: {
                      label: "Desfazer",
                      onClick: async () => {
                        const r = await restoreEvent({ id: event.id });
                        if (r.ok) router.refresh();
                        else toast.error(r.message);
                      },
                    },
                  });
                })
              }
            >
              <Trash2 aria-hidden="true" /> Excluir
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" form="event-form" disabled={pending}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              {event ? "Salvar evento" : "Criar evento"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
