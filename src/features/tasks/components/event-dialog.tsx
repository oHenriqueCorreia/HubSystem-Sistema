"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { AlertTriangle, CalendarSearch, LoaderCircle, Mail, Plus, Trash2, X } from "lucide-react";
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
import { dayKey, minutesOfDay, overlapsBusy, zonedIso, type Interval } from "@/domain/calendar";
import { createEvent, deleteEvent, getAvailability, restoreEvent, updateEvent, type Availability } from "../actions";
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

const RESPONSE_LABEL: Record<string, string> = { accepted: "Confirmou", declined: "Recusou", tentative: "Talvez" };

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
          guests: event.guests.map((g) => ({ email: g.email, name: g.name, optional: g.optional })),
          sendUpdates: event.send_updates,
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
          guests: [],
          sendUpdates: true,
          reminderMinutes: 30,
        },
  });
  const allDay = useWatch({ control: form.control, name: "allDay" });
  const [date, startTime, endTime, ownerId] = useWatch({ control: form.control, name: ["date", "startTime", "endTime", "ownerId"] });
  const guests = useFieldArray({ control: form.control, name: "guests" });
  const [guestEmail, setGuestEmail] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestError, setGuestError] = useState<string | null>(null);
  const [avail, setAvail] = useState<(Availability & { date: string }) | null>(null);
  const [loadingAvail, startAvail] = useTransition();
  const { errors } = form.formState;
  const responses = new Map(event?.guests.map((g) => [g.email, g.response_status]) ?? []);

  function addGuest() {
    const email = guestEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setGuestError("Informe um e-mail válido.");
    if (guests.fields.some((g) => g.email === email)) return setGuestError("Este convidado já está na lista.");
    guests.append({ email, name: guestName.trim(), optional: false });
    setGuestEmail("");
    setGuestName("");
    setGuestError(null);
  }

  function loadAvailability() {
    if (!date) return;
    startAvail(async () => {
      const res = await getAvailability({ date, ownerId: ownerId ?? null });
      if (res.ok) setAvail({ ...(res.data as Availability), date });
      else toast.error(res.message);
    });
  }

  // Conflito com horários ocupados (exceto o próprio evento sendo editado).
  const ownSlot: Interval | null = event ? { start: event.starts_at, end: event.ends_at } : null;
  const busyOthers = avail ? avail.busy.filter((b) => !ownSlot || b.start !== ownSlot.start || b.end !== ownSlot.end) : [];
  const conflict =
    avail && avail.date === date && !allDay && startTime && endTime && endTime > startTime
      ? overlapsBusy({ start: zonedIso(date, startTime), end: zonedIso(date, endTime) }, busyOthers)
      : false;

  function pickSlot(slot: Interval) {
    const dur = startTime && endTime && endTime > startTime ? minutesOfDay(zonedIso(date, endTime)) - minutesOfDay(zonedIso(date, startTime)) : 60;
    const s0 = minutesOfDay(slot.start);
    const e0 = Math.min(s0 + dur, minutesOfDay(slot.end));
    const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    form.setValue("startTime", fmt(s0));
    form.setValue("endTime", fmt(e0));
  }

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
          {!allDay && (
            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Horários livres</p>
                <Button type="button" variant="outline" size="sm" onClick={loadAvailability} disabled={loadingAvail || !date}>
                  {loadingAvail ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <CalendarSearch aria-hidden="true" />}
                  {avail?.date === date ? "Atualizar" : "Ver horários livres"}
                </Button>
              </div>
              {conflict && (
                <p role="alert" className="flex items-center gap-2 text-sm text-warning">
                  <AlertTriangle className="size-4 shrink-0" aria-hidden="true" /> Este horário conflita com outro compromisso.
                </p>
              )}
              {avail?.date === date &&
                (avail.free.length ? (
                  <ul className="flex flex-wrap gap-1.5" aria-label="Faixas livres">
                    {avail.free.map((f) => (
                      <li key={f.start}>
                        <button
                          type="button"
                          onClick={() => pickSlot(f)}
                          className="rounded-md border bg-surface px-2 py-1 text-xs tabular hover:border-primary hover:bg-accent"
                        >
                          {hhmm(f.start)}–{hhmm(f.end)}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Sem horários livres neste dia dentro do expediente.</p>
                ))}
              {avail?.date === date && (
                <p className="text-xs text-muted-foreground">
                  {avail.source === "google" ? "Inclui sua agenda do Google (apenas livre/ocupado)." : "Com base na agenda do Hub System."} Expediente {avail.workHours.start}–
                  {avail.workHours.end}.
                </p>
              )}
            </div>
          )}
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
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Convidados por e-mail (opcional)</legend>
            {guests.fields.length > 0 && (
              <ul className="grid gap-1">
                {guests.fields.map((g, i) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
                    <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">
                      {g.name ? `${g.name} · ` : ""}
                      {g.email}
                    </span>
                    {responses.get(g.email) && responses.get(g.email) !== "needsAction" && (
                      <span className="text-xs text-muted-foreground">{RESPONSE_LABEL[responses.get(g.email)!] ?? ""}</span>
                    )}
                    <label className="flex items-center gap-1 text-xs">
                      <Controller
                        control={form.control}
                        name={`guests.${i}.optional`}
                        render={({ field }) => <Checkbox checked={field.value ?? false} onCheckedChange={(v) => field.onChange(Boolean(v))} />}
                      />
                      Opcional
                    </label>
                    <Button type="button" variant="ghost" size="icon-xs" onClick={() => guests.remove(i)} aria-label={`Remover ${g.email}`}>
                      <X aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Nome" aria-label="Nome do convidado" autoComplete="off" />
              <Input
                type="email"
                inputMode="email"
                spellCheck={false}
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addGuest();
                  }
                }}
                placeholder="email@exemplo.com"
                aria-label="E-mail do convidado"
                autoComplete="off"
              />
              <Button type="button" variant="outline" onClick={addGuest}>
                <Plus aria-hidden="true" /> Adicionar
              </Button>
            </div>
            {guestError && (
              <p role="alert" className="text-sm text-danger">
                {guestError}
              </p>
            )}
            {guests.fields.length > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <Controller control={form.control} name="sendUpdates" render={({ field }) => <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />} />
                Enviar convite e atualizações por e-mail (pelo Google Agenda)
              </label>
            )}
          </fieldset>
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
