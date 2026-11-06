"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { FormAlert, FormField } from "@/components/app/form-field";
import { formatPhone } from "@/domain/shared/phone";
import { createRole, updateMyProfile, updateOrganization } from "../actions";
import { createRoleSchema, orgSettingsSchema, profileSchema } from "../schemas";
import type { RoleRow, RoleTemplate } from "../queries";

function useSubmit<T>(action: (v: T) => Promise<{ ok: boolean; message?: string; fieldErrors?: Record<string, string[]> }>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const submit = (values: T, onOk?: () => void) => {
    setError(null);
    startTransition(async () => {
      const res = await action(values);
      if (!res.ok) {
        setError(res.message ?? "Não foi possível salvar.");
        return;
      }
      toast.success(res.message ?? "Salvo.");
      onOk?.();
      router.refresh();
    });
  };
  return { pending, error, submit };
}

export function ProfileForm({ initial }: { initial: { full_name: string; job_title: string | null; phone_e164: string | null; email: string } }) {
  const form = useForm<z.input<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: initial.full_name, jobTitle: initial.job_title ?? "", phone: formatPhone(initial.phone_e164) },
  });
  const { pending, error, submit } = useSubmit(updateMyProfile);
  return (
    <form onSubmit={form.handleSubmit((v) => submit(v))} noValidate className="grid max-w-lg gap-4">
      <FormAlert>{error}</FormAlert>
      <FormField label="E-mail" hint="Para trocar o e-mail, fale com o administrador.">
        <Input value={initial.email} readOnly disabled />
      </FormField>
      <FormField label="Nome" error={form.formState.errors.fullName?.message} required>
        <Input autoComplete="name" {...form.register("fullName")} />
      </FormField>
      <FormField label="Cargo" optional>
        <Input autoComplete="organization-title" {...form.register("jobTitle")} />
      </FormField>
      <FormField label="Telefone" error={form.formState.errors.phone?.message} optional>
        <Input type="tel" inputMode="tel" autoComplete="tel" {...form.register("phone")} />
      </FormField>
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar perfil
      </Button>
    </form>
  );
}

export function OrganizationForm({ name, whatsappMessage }: { name: string; whatsappMessage: string }) {
  const form = useForm<z.input<typeof orgSettingsSchema>>({
    resolver: zodResolver(orgSettingsSchema),
    defaultValues: { name, whatsappMessage },
  });
  const { pending, error, submit } = useSubmit(updateOrganization);
  return (
    <form onSubmit={form.handleSubmit((v) => submit(v))} noValidate className="grid max-w-lg gap-4">
      <FormAlert>{error}</FormAlert>
      <FormField label="Nome da empresa" error={form.formState.errors.name?.message} required>
        <Input {...form.register("name")} />
      </FormField>
      <FormField
        label="Mensagem padrão do WhatsApp"
        hint="Variáveis: {nome}, {empresa}, {responsavel}. Usada quando nenhum modelo é escolhido."
        error={form.formState.errors.whatsappMessage?.message}
      >
        <Textarea rows={4} {...form.register("whatsappMessage")} />
      </FormField>
      <p className="text-sm text-muted-foreground">Moeda: real (BRL) · Fuso horário: São Paulo (America/Sao_Paulo)</p>
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar configurações
      </Button>
    </form>
  );
}

const START_EMPTY = "nenhum";
const TEMPLATE_PREFIX = "modelo:";

export function CreateRoleDialog({ roles, templates = [] }: { roles: RoleRow[]; templates?: RoleTemplate[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const startId = useId();
  const form = useForm<z.input<typeof createRoleSchema>>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: { name: "", description: "", copyFrom: null, template: null },
  });
  const copyFrom = useWatch({ control: form.control, name: "copyFrom" });
  const { pending, error, submit } = useSubmit(async (v: z.input<typeof createRoleSchema>) => {
    const res = await createRole(v);
    if (res.ok) router.push(`/configuracoes/papeis/${(res.data as { id: string }).id}`);
    return res;
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden="true" /> Novo papel
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo papel</DialogTitle>
          <DialogDescription>Comece de um modelo por função, copie um papel existente ou comece do zero. Depois ajuste as permissões à vontade.</DialogDescription>
        </DialogHeader>
        <form id="role-form" onSubmit={form.handleSubmit((v) => submit(v, () => setOpen(false)))} noValidate className="grid gap-3">
          <FormAlert>{error}</FormAlert>
          <div className="grid gap-1.5">
            <Label htmlFor={startId} className="text-sm font-medium">
              Começar de
            </Label>
            <Controller
              control={form.control}
              name="template"
              render={({ field }) => {
                const value = field.value ? `${TEMPLATE_PREFIX}${field.value}` : (copyFrom ?? START_EMPTY);
                return (
                  <Select
                    value={value}
                    onValueChange={(v) => {
                      if (v.startsWith(TEMPLATE_PREFIX)) {
                        const key = v.slice(TEMPLATE_PREFIX.length);
                        field.onChange(key);
                        form.setValue("copyFrom", null);
                        const tpl = templates.find((t) => t.key === key);
                        // Sugere nome e descrição do modelo sem apagar o que a pessoa já escreveu.
                        if (tpl && !form.getValues("name")) form.setValue("name", tpl.name);
                        if (tpl && !form.getValues("description")) form.setValue("description", tpl.description.slice(0, 200));
                      } else {
                        field.onChange(null);
                        form.setValue("copyFrom", v === START_EMPTY ? null : v);
                      }
                    }}
                  >
                    <SelectTrigger id={startId} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={START_EMPTY}>Começar sem permissões</SelectItem>
                      {templates.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>Modelos por função</SelectLabel>
                          {templates.map((t) => (
                            <SelectItem key={t.key} value={`${TEMPLATE_PREFIX}${t.key}`}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      <SelectGroup>
                        <SelectLabel>Copiar um papel existente</SelectLabel>
                        {roles.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                );
              }}
            />
          </div>
          <FormField label="Nome" error={form.formState.errors.name?.message} required>
            <Input autoFocus {...form.register("name")} />
          </FormField>
          <FormField label="Descrição" optional>
            <Input {...form.register("description")} />
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="role-form" disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Criar papel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
