"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { ArrowDown, ArrowUp, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

export function CadenceEditor({ trigger, template }: { trigger: ReactNode; template?: CadenceTemplate }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<CadenceTemplateValues>({
    defaultValues: {
      id: template?.id,
      name: template?.name ?? "",
      description: template?.description ?? "",
      isActive: template?.is_active ?? true,
      steps: template?.steps.map((s) => ({
        dayOffset: s.day_offset,
        timeOfDay: s.time_of_day.slice(0, 5),
        channel: s.channel as CadenceTemplateValues["steps"][number]["channel"],
        title: s.title,
        instruction: s.instruction,
        message: s.message,
      })) ?? [{ dayOffset: 0, timeOfDay: "09:00", channel: "whatsapp", title: "Primeiro contato", instruction: "", message: "" }],
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
          <DialogTitle>{template ? "Editar cadência" : "Nova cadência"}</DialogTitle>
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
                  <FormField label="Mensagem sugerida" hint="Variáveis: {nome}, {empresa}" optional>
                    <Textarea rows={2} {...form.register(`steps.${i}.message`)} />
                  </FormField>
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
