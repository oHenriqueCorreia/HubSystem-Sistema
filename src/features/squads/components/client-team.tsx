"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LoaderCircle, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { FormField } from "@/components/app/form-field";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { addClientMember, removeClientMember } from "../actions";
import type { ClientTeam as Team, PersonOption } from "../queries";

/** Quem trabalha no cliente. Gerenciar exige admin.users (people só chega quando pode). */
export function ClientTeam({ clientId, team, people }: { clientId: string; team: Team; people: PersonOption[] | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [userId, setUserId] = useState("");
  const [roleLabel, setRoleLabel] = useState("");
  const personFieldId = useId();
  const available = (people ?? []).filter((p) => !team.members.some((m) => m.user_id === p.id));

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        if (res.message) toast.success(res.message);
        after?.();
        router.refresh();
      } else toast.error(res.message);
    });
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    run(
      () => addClientMember({ clientId, userId, roleLabel }),
      () => {
        setUserId("");
        setRoleLabel("");
      },
    );
  }

  return (
    <section className="grid gap-2" aria-labelledby="equipe-cliente">
      <h2 id="equipe-cliente" className="text-sm font-semibold">
        Equipe do cliente
      </h2>
      {team.members.length === 0 && team.squads.length === 0 && (
        <p className="text-muted-foreground">Ninguém associado. Só vê este cliente quem tem acesso pelo papel.</p>
      )}
      {team.members.length > 0 && (
        <ul className="grid gap-1">
          {team.members.map((m) => (
            <li key={m.user_id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 wrap-break-word">
                {m.name}
                {m.role_label && <span className="text-muted-foreground"> ({m.role_label})</span>}
              </span>
              {people && (
                <ConfirmDialog
                  tone="danger"
                  trigger={
                    <Button variant="ghost" size="icon" className="size-11 shrink-0" disabled={pending} aria-label={`Remover ${m.name} da equipe do cliente`}>
                      <X aria-hidden="true" />
                    </Button>
                  }
                  title={`Remover ${m.name} deste cliente?`}
                  description="A pessoa deixa de ver as tarefas, a agenda e as conversas deste cliente, a não ser que tenha acesso pelo papel ou por um squad."
                  confirmLabel="Remover do cliente"
                  onConfirm={() => run(() => removeClientMember({ clientId, userId: m.user_id }))}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {team.squads.length > 0 && (
        <p>
          <span className="text-muted-foreground">Squads: </span>
          {team.squads.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ", "}
              {people ? (
                <Link href="/configuracoes/squads" className="text-primary underline-offset-4 hover:underline">
                  {s.name}
                </Link>
              ) : (
                s.name
              )}
            </span>
          ))}
        </p>
      )}
      {people && (
        <form onSubmit={add} className="grid gap-2 rounded-lg border p-3">
          <div className="grid gap-1.5">
            <Label htmlFor={personFieldId} className="text-sm font-medium">
              Pessoa
            </Label>
            <Select value={userId} onValueChange={setUserId} disabled={!available.length}>
              <SelectTrigger id={personFieldId} className="w-full">
                <SelectValue placeholder={available.length ? "Escolha quem vai trabalhar aqui" : "Todos já estão associados"} />
              </SelectTrigger>
              <SelectContent>
                {available.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FormField label="Função neste cliente" optional>
            <Input value={roleLabel} maxLength={60} onChange={(e) => setRoleLabel(e.target.value)} placeholder="Ex.: Designer…" autoComplete="off" />
          </FormField>
          <Button type="submit" variant="outline" disabled={pending || !userId}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <UserPlus aria-hidden="true" />} Associar ao cliente
          </Button>
          <p className="text-xs text-muted-foreground">A pessoa passa a ver as tarefas, a agenda e as conversas deste cliente, dentro das permissões do papel dela.</p>
        </form>
      )}
    </section>
  );
}
