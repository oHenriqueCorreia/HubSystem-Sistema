"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormAlert, FormField } from "@/components/app/form-field";
import { UFS } from "@/domain/crm/import";
import { leadFormSchema, type LeadFormValues } from "../schemas";
import { createLead, updateLead } from "../actions";
import { SERVICE_OPTIONS, type CrmLookups, type Lead } from "../types";

const NONE = "__nenhum__";

export function LeadFormDialog({
  trigger,
  lookups,
  lead,
  canAssign,
}: {
  trigger: ReactNode;
  lookups: CrmLookups;
  lead?: Lead;
  canAssign?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [pipelineId, setPipelineId] = useState(lookups.pipelines[0]?.id ?? "");

  const form = useForm<LeadFormValues>({
    resolver: zodResolver(leadFormSchema),
    defaultValues: {
      name: lead?.name ?? "",
      company_name: lead?.company_name ?? "",
      phone: lead?.phone_raw ?? lead?.phone_e164 ?? "",
      whatsapp: lead?.whatsapp_e164 ?? "",
      email: lead?.email ?? "",
      website: lead?.website ?? "",
      instagram: lead?.instagram ?? "",
      facebook: lead?.facebook ?? "",
      linkedin: lead?.linkedin ?? "",
      address: lead?.address ?? "",
      neighborhood: lead?.neighborhood ?? "",
      city: lead?.city ?? "",
      state: lead?.state ?? "",
      zip: lead?.zip ?? "",
      gmb_url: lead?.gmb_url ?? "",
      category: lead?.category ?? "",
      segment_id: lead?.segment_id ?? null,
      source: lead?.source ?? "",
      owner_id: lead?.owner_id ?? null,
      services_interest: lead?.services_interest ?? [],
      notes: lead?.notes ?? "",
    },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    startTransition(async () => {
      const res = lead ? await updateLead({ ...values, id: lead.id }) : await createLead({ ...values, pipelineId });
      if (!res.ok) {
        setServerError(res.message);
        for (const [k, msgs] of Object.entries(res.fieldErrors ?? {})) {
          form.setError(k as keyof LeadFormValues, { message: msgs[0] });
        }
        return;
      }
      toast.success(res.message);
      setOpen(false);
      if (!lead && res.data && typeof res.data === "object" && "id" in res.data) router.push(`/crm/leads/${(res.data as { id: string }).id}`);
      else router.refresh();
    });
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lead ? "Editar lead" : "Novo lead"}</DialogTitle>
          <DialogDescription>Só o nome é obrigatório. Telefones são salvos no formato internacional.</DialogDescription>
        </DialogHeader>

        <form id="lead-form" onSubmit={onSubmit} noValidate className="grid gap-6">
          <FormAlert>{serverError}</FormAlert>

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">Contato</legend>
            <FormField label="Nome" error={errors.name?.message} required className="sm:col-span-2">
              <Input autoFocus {...form.register("name")} />
            </FormField>
            <FormField label="Telefone" error={errors.phone?.message} optional>
              <Input type="tel" inputMode="tel" autoComplete="off" placeholder="(11) 99999-0000" {...form.register("phone")} />
            </FormField>
            <FormField label="WhatsApp" hint="Se vazio, usamos o celular." error={errors.whatsapp?.message} optional>
              <Input type="tel" inputMode="tel" autoComplete="off" placeholder="(11) 99999-0000" {...form.register("whatsapp")} />
            </FormField>
            <FormField label="E-mail" error={errors.email?.message} optional className="sm:col-span-2">
              <Input type="email" spellCheck={false} inputMode="email" autoComplete="off" {...form.register("email")} />
            </FormField>
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">Negócio</legend>
            {!lead && lookups.pipelines.length > 1 && (
              <FormField label="Funil">
                <Select value={pipelineId} onValueChange={setPipelineId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {lookups.pipelines.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
            <FormField label="Segmento" optional>
              <Controller
                control={form.control}
                name="segment_id"
                render={({ field }) => (
                  <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Sem segmento</SelectItem>
                      {lookups.segments.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
            <FormField label="Origem" optional>
              <Input placeholder="Google Maps, indicação…" {...form.register("source")} />
            </FormField>
            {canAssign && (
              <FormField label="Responsável" optional>
                <Controller
                  control={form.control}
                  name="owner_id"
                  render={({ field }) => (
                    <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Eu mesmo</SelectItem>
                        {lookups.owners.map((o) => (
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
            <div className="grid gap-2 sm:col-span-2">
              <span className="text-sm font-medium" id="servicos-label">
                Serviços de interesse
              </span>
              <Controller
                control={form.control}
                name="services_interest"
                render={({ field }) => (
                  <div role="group" aria-labelledby="servicos-label" className="flex flex-wrap gap-x-4 gap-y-2">
                    {SERVICE_OPTIONS.map((s) => {
                      const checked = field.value?.includes(s) ?? false;
                      return (
                        <label key={s} className="flex min-h-8 items-center gap-2 text-sm">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) =>
                              field.onChange(v ? [...(field.value ?? []), s] : (field.value ?? []).filter((x) => x !== s))
                            }
                          />
                          {s}
                        </label>
                      );
                    })}
                  </div>
                )}
              />
            </div>
          </fieldset>

          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" className="group -ml-2 justify-start">
                <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
                Endereço, redes e Google Meu Negócio
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 grid gap-3 sm:grid-cols-2">
              <FormField label="Endereço" optional className="sm:col-span-2">
                <Input {...form.register("address")} />
              </FormField>
              <FormField label="Bairro" optional>
                <Input {...form.register("neighborhood")} />
              </FormField>
              <FormField label="Cidade" optional>
                <Input {...form.register("city")} />
              </FormField>
              <FormField label="UF" error={errors.state?.message} optional>
                <Controller
                  control={form.control}
                  name="state"
                  render={({ field }) => (
                    <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>—</SelectItem>
                        {UFS.map((uf) => (
                          <SelectItem key={uf} value={uf}>
                            {uf}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
              <FormField label="CEP" error={errors.zip?.message} optional>
                <Input inputMode="numeric" placeholder="00000-000" {...form.register("zip")} />
              </FormField>
              <FormField label="Site" optional>
                <Input type="url" placeholder="https://" {...form.register("website")} />
              </FormField>
              <FormField label="Instagram" optional>
                <Input {...form.register("instagram")} />
              </FormField>
              <FormField label="Facebook" optional>
                <Input {...form.register("facebook")} />
              </FormField>
              <FormField label="LinkedIn" optional>
                <Input {...form.register("linkedin")} />
              </FormField>
              <FormField label="Link do Google Meu Negócio / Maps" optional className="sm:col-span-2">
                <Input type="url" {...form.register("gmb_url")} />
              </FormField>
              <FormField label="Categoria no Google" optional>
                <Input {...form.register("category")} />
              </FormField>
              <FormField label="Razão social" optional>
                <Input {...form.register("company_name")} />
              </FormField>
            </CollapsibleContent>
          </Collapsible>

          <FormField label="Observações" optional>
            <Textarea rows={3} {...form.register("notes")} />
          </FormField>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form="lead-form" disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {lead ? "Salvar alterações" : "Cadastrar lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
