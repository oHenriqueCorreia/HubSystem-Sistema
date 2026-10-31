"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { ArrowDown, ArrowUp, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormAlert, FormField } from "@/components/app/form-field";
import { saveCadence } from "../actions";
import { cadenceTemplateSchema, type CadenceTemplateValues } from "../schemas";
import { CHANNEL_LABEL } from "../types";
import type { CadenceTemplate } from "../queries";

const NONE = "__nenhum__";

export function CadenceEditor({
  trigger,
  template,
  starter,
  tags = [],
  stages = [],
}: {
  trigger: ReactNode;
  template?: CadenceTemplate;
  starter?: CadenceTemplateValues;
  tags?: { id: string; name: string }[];
  stages?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<CadenceTemplateValues>({
    defaultValues: {
      id: template?.id,
      name: template?.name ?? starter?.name ?? "",
      description: template?.description ?? starter?.description ?? "",
      isActive: template?.is_active ?? starter?.isActive ?? true,
      requireConsent: template?.require_consent ?? true,
      windowStart: template?.send_window?.start ?? "08:00",
      windowEnd: template?.send_window?.end ?? "20:00",
      steps: template?.steps.map((s) => ({
        dayOffset: s.day_offset,
        timeOfDay: s.time_of_day.slice(0, 5),
        channel: s.channel as CadenceTemplateValues["steps"][number]["channel"],
        title: s.title,
        instruction: s.instruction,
        message: s.message,
        autoSend: s.auto_send,
        whatsappTemplate: s.whatsapp_template,
        templateLanguage: s.template_language,
        addTagId: s.add_tag_id,
        moveToStageId: s.move_to_stage_id,
      })) ?? starter?.steps ?? [{ dayOffset: 0, timeOfDay: "09:00", channel: "whatsapp", title: "Primeiro contato", instruction: "", message: "" }],
    },
  });
  const steps = useFieldArray({ control: form.control, name: "steps" });
  const { errors } = form.formState;

  const submit = form.handleSubmit((values) => {
    setError(null);
    const parsed = cadenceTemplateSchema.safeParse(values);
    if (!parsed.success) {
      for (const i of parsed.error.issues) form.setError(i.path.join(".") as never, { message: i.message });
      setError("Revise os campos destacados.");
      return;
    }
    startTransition(async () => {
      const res = await saveCadence(values);
      if (!res.ok) return void setError(res.message);
      toast.success(res.message);
      setOpen(false);
      router.refresh();
    });
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{template ? "Editar cadência" : starter ? `Criar: ${starter.name}` : "Nova cadência"}</DialogTitle>
          <DialogDescription>
            Cada etapa vira uma tarefa com data e hora ao inscrever um lead. O envio de mensagens é sempre manual. Alterar o modelo não muda tarefas já criadas.
          </DialogDescription>
        </DialogHeader>
        <form id="cadence-form" onSubmit={submit} noValidate className="grid gap-5">
          <FormAlert>{error}</FormAlert>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <FormField label="Nome" error={errors.name?.message} required>
              <Input {...form.register("name")} />
            </FormField>
            <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
              <FormField label="Envios automáticos a partir de" error={errors.windowStart?.message}>
                <Input type="time" {...form.register("windowStart")} />
              </FormField>
              <FormField label="Até" error={errors.windowEnd?.message}>
                <Input type="time" {...form.register("windowEnd")} />
              </FormField>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <Controller control={form.control} name="requireConsent" render={({ field }) => <Checkbox checked={field.value ?? true} onCheckedChange={(v) => field.onChange(Boolean(v))} />} />
                Exigir consentimento
              </label>
              <p className="text-xs text-muted-foreground sm:col-span-3">Dias úteis, horário de Brasília. Quem pede para parar ou responde tem a cadência bloqueada ou pausada automaticamente.</p>
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <Controller control={form.control} name="isActive" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
              Ativa
            </label>
          </div>
          <FormField label="Descrição" optional>
            <Input {...form.register("description")} />
          </FormField>

          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-semibold">Etapas</legend>
            <ol className="grid gap-3">
              {steps.fields.map((f, i) => (
                <li key={f.id} className="grid gap-3 rounded-lg border bg-surface p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">Etapa {i + 1}</span>
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" size="icon-xs" disabled={i === 0} onClick={() => steps.move(i, i - 1)} aria-label={`Subir etapa ${i + 1}`}>
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-xs" disabled={i === steps.fields.length - 1} onClick={() => steps.move(i, i + 1)} aria-label={`Descer etapa ${i + 1}`}>
                        <ArrowDown aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-xs" disabled={steps.fields.length === 1} onClick={() => steps.remove(i)} aria-label={`Remover etapa ${i + 1}`}>
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_7rem_7rem_9rem]">
                    <FormField label="Título" error={errors.steps?.[i]?.title?.message}>
                      <Input {...form.register(`steps.${i}.title`)} />
                    </FormField>
                    <FormField label="Dia" hint="0 = no dia" error={errors.steps?.[i]?.dayOffset?.message}>
                      <Input type="number" min={0} max={365} {...form.register(`steps.${i}.dayOffset`, { valueAsNumber: true })} />
                    </FormField>
                    <FormField label="Hora" error={errors.steps?.[i]?.timeOfDay?.message}>
                      <Input type="time" {...form.register(`steps.${i}.timeOfDay`)} />
                    </FormField>
                    <FormField label="Canal">
                      <Controller
                        control={form.control}
                        name={`steps.${i}.channel`}
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
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
                  </div>
                  <FormField label="Instrução" optional>
                    <Input {...form.register(`steps.${i}.instruction`)} />
                  </FormField>
                  <FormField label="Mensagem sugerida" hint="{nome} e {empresa} são preenchidos com os dados do lead ao iniciar a cadência." optional>
                    <Textarea rows={2} {...form.register(`steps.${i}.message`)} />
                  </FormField>
                  <fieldset className="grid gap-2 rounded-md border border-dashed p-2">
                    <legend className="px-1 text-xs font-medium text-muted-foreground">Automação (opcional)</legend>
                    <label className="flex items-center gap-2 text-sm">
                      <Controller
                        control={form.control}
                        name={`steps.${i}.autoSend`}
                        render={({ field }) => <Checkbox checked={field.value ?? false} onCheckedChange={(v) => field.onChange(Boolean(v))} />}
                      />
                      Executar automaticamente no horário
                    </label>
                    <div className="grid gap-2 sm:grid-cols-[1fr_7rem]">
                      <FormField label="Modelo aprovado do WhatsApp" hint="Nome exato do modelo na Meta. {{1}} = primeiro nome, {{2}} = empresa." error={errors.steps?.[i]?.whatsappTemplate?.message} optional>
                        <Input placeholder="ex.: primeiro_contato" {...form.register(`steps.${i}.whatsappTemplate`, { setValueAs: (v) => v || null })} />
                      </FormField>
                      <FormField label="Idioma" optional>
                        <Input {...form.register(`steps.${i}.templateLanguage`)} />
                      </FormField>
                    </div>
                    {tags.length > 0 && (
                      <FormField label="Adicionar etiqueta ao lead" optional>
                        <Controller
                          control={form.control}
                          name={`steps.${i}.addTagId`}
                          render={({ field }) => (
                            <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE}>Nenhuma</SelectItem>
                                {tags.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    {t.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </FormField>
                    )}
                    {stages.length > 0 && (
                      <FormField label="Mover o negócio para a etapa" optional>
                        <Controller
                          control={form.control}
                          name={`steps.${i}.moveToStageId`}
                          render={({ field }) => (
                            <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE}>Não mover</SelectItem>
                                {stages.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    {s.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </FormField>
                    )}
                  </fieldset>
                </li>
              ))}
            </ol>
            <Button
              type="button"
              variant="outline"
              className="justify-self-start"
              onClick={() => {
                const last = form.getValues(`steps.${steps.fields.length - 1}.dayOffset`) ?? 0;
                steps.append({ dayOffset: Number(last) + 2, timeOfDay: "10:00", channel: "whatsapp", title: "", instruction: "", message: "" });
              }}
            >
              <Plus aria-hidden="true" /> Adicionar etapa
            </Button>
          </fieldset>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form="cadence-form" disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar cadência
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
