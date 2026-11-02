"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, KeyRound, LoaderCircle, SlidersHorizontal, UserPlus } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormAlert, FormField } from "@/components/app/form-field";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { formatDateTime } from "@/domain/shared/dates";
import { generateAccessLink, setUserActive, setUserRole } from "../actions";
import { inviteUser } from "../invitations";
import { inviteSchema } from "../schemas";
import type { RoleRow, UserRow } from "../queries";

export function InviteUserDialog({ roles, canCreateWorkspaces }: { roles: RoleRow[]; canCreateWorkspaces: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.input<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: "",
      fullName: "",
      mode: "equipe",
      workspaceName: "",
      overrides: [],
      roleId: roles.find((r) => r.key === "colaborador")?.id ?? roles[0]?.id ?? null,
    },
  });
  const mode = useWatch({ control: form.control, name: "mode" });

  const onSubmit = form.handleSubmit((values) => {
    setError(null);
    startTransition(async () => {
      const res = await inviteUser(values);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      toast.success(res.message);
      form.reset();
      setOpen(false);
      router.refresh();
    });
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden="true" /> Convidar usuário
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar usuário</DialogTitle>
          <DialogDescription>A pessoa recebe um e-mail com um link pessoal, válido por 7 dias e de uso único.</DialogDescription>
        </DialogHeader>
        <form id="invite-form" onSubmit={onSubmit} noValidate className="grid gap-3">
          <FormAlert>{error}</FormAlert>
          {canCreateWorkspaces && (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Tipo de acesso</legend>
              <Controller
                control={form.control}
                name="mode"
                render={({ field }) => (
                  <RadioGroup value={field.value} onValueChange={field.onChange} className="grid gap-2 sm:grid-cols-2">
                    <label className="flex cursor-pointer gap-2 rounded-md border p-3 text-sm has-[[data-state=checked]]:border-primary">
                      <RadioGroupItem value="equipe" className="mt-0.5" />
                      <span>
                        <span className="font-medium">Entrar na minha equipe</span>
                        <span className="block text-xs text-muted-foreground">Vê os dados da organização conforme o papel.</span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer gap-2 rounded-md border p-3 text-sm has-[[data-state=checked]]:border-primary">
                      <RadioGroupItem value="ambiente" className="mt-0.5" />
                      <span>
                        <span className="font-medium">Ambiente próprio</span>
                        <span className="block text-xs text-muted-foreground">Começa vazio, como uma empresa separada. Não vê seus dados.</span>
                      </span>
                    </label>
                  </RadioGroup>
                )}
              />
            </fieldset>
          )}
          <FormField label="Nome" error={form.formState.errors.fullName?.message} required>
            <Input autoFocus autoComplete="off" {...form.register("fullName")} />
          </FormField>
          <FormField label="E-mail" error={form.formState.errors.email?.message} required>
            <Input type="email" spellCheck={false} inputMode="email" autoComplete="off" {...form.register("email")} />
          </FormField>
          {mode === "ambiente" ? (
            <FormField label="Nome da empresa dessa pessoa" error={form.formState.errors.workspaceName?.message} required>
              <Input {...form.register("workspaceName")} />
            </FormField>
          ) : (
            <FormField
              label="Papel"
              hint="Permissões finas podem ser ajustadas depois, em Usuários → Permissões."
              error={form.formState.errors.roleId?.message}
              required
            >
              <Controller
                control={form.control}
                name="roleId"
                render={({ field }) => (
                  <Select value={field.value ?? ""} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form="invite-form" disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Enviar convite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UsersTable({ users, roles, meId, canEditPermissions }: { users: UserRow[]; roles: RoleRow[]; meId: string; canEditPermissions: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        if (res.message) toast.success(res.message);
        router.refresh();
      } else toast.error(res.message);
    });
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuário</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Último acesso</TableHead>
              <TableHead>
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              const me = u.id === meId;
              return (
                <TableRow key={u.id} className={u.is_active ? undefined : "text-muted-foreground"}>
                  <TableCell>
                    <div className="font-medium">
                      {u.full_name || "Sem nome"} {me && <Badge variant="secondary">Você</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell className="min-w-44">
                    <Select value={u.role?.id ?? ""} disabled={pending} onValueChange={(roleId) => run(() => setUserRole({ userId: u.id, roleId }))}>
                      <SelectTrigger className="w-full" aria-label={`Papel de ${u.full_name || u.email}`}>
                        <SelectValue placeholder="Sem papel" />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {me ? (
                      <span className="text-sm">Ativo</span>
                    ) : u.is_active ? (
                      <ConfirmDialog
                        tone="danger"
                        trigger={
                          <label className="flex items-center gap-2 text-sm">
                            <Switch checked aria-label={`Desativar ${u.full_name || u.email}`} /> Ativo
                          </label>
                        }
                        title={`Desativar ${u.full_name || u.email}?`}
                        description="A pessoa perde o acesso imediatamente e as sessões abertas são encerradas. Os registros dela continuam no sistema."
                        confirmLabel="Desativar acesso"
                        onConfirm={() => run(() => setUserActive({ userId: u.id, active: false }))}
                      />
                    ) : (
                      <label className="flex items-center gap-2 text-sm">
                        <Switch checked={false} disabled={pending} onCheckedChange={() => run(() => setUserActive({ userId: u.id, active: true }))} aria-label={`Reativar ${u.full_name || u.email}`} />
                        Inativo
                      </label>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{u.last_seen_at ? formatDateTime(u.last_seen_at) : "Nunca entrou"}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {canEditPermissions && (
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/configuracoes/usuarios/${u.id}`}>
                            <SlidersHorizontal aria-hidden="true" /> Permissões
                          </Link>
                        </Button>
                      )}
                      {!me && u.is_active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            startTransition(async () => {
                              const res = await generateAccessLink({ userId: u.id });
                              if (res.ok) setLink((res.data as { link: string }).link);
                              else toast.error(res.message);
                            })
                          }
                        >
                          <KeyRound aria-hidden="true" /> Link de acesso
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={Boolean(link)} onOpenChange={(v) => !v && setLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link de acesso</DialogTitle>
            <DialogDescription>Envie para a pessoa por um canal seguro. Ele permite definir uma nova senha, vale por 1 hora e funciona uma única vez.</DialogDescription>
          </DialogHeader>
          <Input readOnly value={link ?? ""} onFocus={(e) => e.target.select()} aria-label="Link de acesso" />
          <DialogFooter>
            <Button
              onClick={async () => {
                await navigator.clipboard.writeText(link ?? "");
                toast.success("Link copiado.");
              }}
            >
              <Copy aria-hidden="true" /> Copiar link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
