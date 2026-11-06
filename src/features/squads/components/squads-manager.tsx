"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Pencil, Plus, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormAlert, FormField } from "@/components/app/form-field";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState } from "@/components/app/states";
import { deleteSquad, saveSquad } from "../actions";
import type { ClientOption, PersonOption, Squad } from "../queries";

const NO_LEADER = "__sem_lider__";

export function SquadsManager({ squads, people, clients }: { squads: Squad[]; people: PersonOption[]; clients: ClientOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const personName = new Map(people.map((p) => [p.id, p.name]));
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteSquad({ id });
      if (res.ok) {
        toast.success(res.message);
        router.refresh();
      } else toast.error(res.message);
    });
  }

  return (
    <div className="grid gap-6">
      <div>
        <SquadFormDialog
          people={people}
          clients={clients}
          trigger={
            <Button>
              <Plus aria-hidden="true" /> Novo squad
            </Button>
          }
        />
      </div>
      {squads.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="Nenhum squad ainda"
          description="Crie um squad, coloque as pessoas e ligue os clientes que ele atende. Cada pessoa passa a ver as tarefas, a agenda e as conversas desses clientes, dentro das permissões do papel dela."
        />
      ) : (
        <ul className="grid gap-2">
          {squads.map((s) => (
            <li key={s.id} className="grid gap-3 rounded-lg border bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="grid min-w-0 gap-2 wrap-break-word">
                <div>
                  <h2 className="font-semibold">{s.name}</h2>
                  {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
                </div>
                <dl className="grid gap-1 text-sm">
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">Líder:</dt>
                    <dd>{s.leader_id ? (personName.get(s.leader_id) ?? "Pessoa inativa") : "Sem líder"}</dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">Pessoas ({s.memberIds.length}):</dt>
                    <dd className="min-w-0">{s.memberIds.length ? s.memberIds.map((id) => personName.get(id) ?? "Pessoa inativa").join(", ") : "Ninguém"}</dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">Clientes ({s.clientIds.length}):</dt>
                    <dd className="min-w-0">{s.clientIds.length ? s.clientIds.map((id) => clientName.get(id) ?? "Cliente sem acesso").join(", ") : "Nenhum"}</dd>
                  </div>
                </dl>
              </div>
              <div className="flex gap-1 self-start">
                <SquadFormDialog
                  squad={s}
                  people={people}
                  clients={clients}
                  trigger={
                    <Button variant="ghost" size="sm" disabled={pending}>
                      <Pencil aria-hidden="true" /> Editar
                    </Button>
                  }
                />
                <ConfirmDialog
                  tone="danger"
                  trigger={
                    <Button variant="ghost" size="sm" disabled={pending}>
                      <Trash2 aria-hidden="true" /> Excluir
                    </Button>
                  }
                  title={`Excluir o squad “${s.name}”?`}
                  description="As pessoas do squad deixam de ver os clientes dele (a não ser que estejam associadas ao cliente diretamente ou tenham acesso pelo papel). Tarefas e dados dos clientes não são apagados."
                  confirmLabel="Excluir squad"
                  onConfirm={() => remove(s.id)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SquadFormDialog({ squad, people, clients, trigger }: { squad?: Squad; people: PersonOption[]; clients: ClientOption[]; trigger: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(squad?.name ?? "");
  const [description, setDescription] = useState(squad?.description ?? "");
  const [leaderId, setLeaderId] = useState<string | null>(squad?.leader_id ?? null);
  const [memberIds, setMemberIds] = useState<string[]>(squad?.memberIds ?? []);
  const [clientIds, setClientIds] = useState<string[]>(squad?.clientIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const leaderFieldId = useId();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNameError(undefined);
    startTransition(async () => {
      const res = await saveSquad({ id: squad?.id, name, description, leaderId, memberIds, clientIds });
      if (!res.ok) {
        // Erro do nome fica junto ao campo; os demais vão para o alerta do formulário.
        if (res.fieldErrors?.name?.[0]) setNameError(res.fieldErrors.name[0]);
        else setError(res.message);
        return;
      }
      toast.success(res.message);
      setOpen(false);
      if (!squad) {
        setName("");
        setDescription("");
        setLeaderId(null);
        setMemberIds([]);
        setClientIds([]);
      }
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto overscroll-contain sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{squad ? "Editar squad" : "Novo squad"}</DialogTitle>
          <DialogDescription>Quem está no squad vê as tarefas, a agenda e as conversas dos clientes ligados a ele, dentro das permissões do papel de cada um.</DialogDescription>
        </DialogHeader>
        <form id="squad-form" onSubmit={submit} className="grid gap-4" noValidate>
          <FormAlert>{error}</FormAlert>
          <FormField label="Nome" required error={nameError}>
            <Input autoFocus autoComplete="off" name="nome" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Squad Tráfego…" />
          </FormField>
          <FormField label="Descrição" optional>
            <Textarea rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          <div className="grid gap-1.5">
            <Label htmlFor={leaderFieldId} className="text-sm font-medium">
              Líder <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Select value={leaderId ?? NO_LEADER} onValueChange={(v) => setLeaderId(v === NO_LEADER ? null : v)}>
              <SelectTrigger id={leaderFieldId} className="w-full" aria-describedby={`${leaderFieldId}-hint`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_LEADER}>Sem líder</SelectItem>
                {people.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id={`${leaderFieldId}-hint`} className="text-xs text-muted-foreground">
              O líder entra no squad automaticamente.
            </p>
          </div>
          <CheckList legend="Pessoas" options={people} selected={memberIds} onChange={setMemberIds} emptyText="Nenhuma pessoa ativa." />
          <CheckList legend="Clientes atendidos" options={clients} selected={clientIds} onChange={setClientIds} emptyText="Nenhum cliente cadastrado." searchable />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form="squad-form" disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} {squad ? "Salvar squad" : "Criar squad"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CheckList({
  legend,
  options,
  selected,
  onChange,
  emptyText,
  searchable = false,
}: {
  legend: string;
  options: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  emptyText: string;
  searchable?: boolean;
}) {
  const [q, setQ] = useState("");
  const searchId = useId();
  const visible = useMemo(() => {
    const term = q.trim().toLocaleLowerCase("pt-BR");
    return term ? options.filter((o) => o.name.toLocaleLowerCase("pt-BR").includes(term)) : options;
  }, [options, q]);
  const toggle = (id: string, on: boolean) => onChange(on ? [...selected, id] : selected.filter((s) => s !== id));

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 flex items-center gap-2 text-sm font-medium">
        {legend} <Badge variant="secondary">{selected.length} selecionado(s)</Badge>
      </legend>
      {searchable && options.length > 8 && (
        <>
          <label htmlFor={searchId} className="sr-only">
            Buscar em {legend.toLowerCase()}
          </label>
          <Input id={searchId} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pelo nome…" autoComplete="off" />
        </>
      )}
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="grid max-h-56 gap-0.5 overflow-y-auto overscroll-contain rounded-md border p-1">
          {visible.map((o) => (
            <li key={o.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded px-2 text-sm hover:bg-muted">
                <Checkbox checked={selected.includes(o.id)} onCheckedChange={(v) => toggle(o.id, v === true)} />
                <span className="min-w-0 truncate">{o.name}</span>
              </label>
            </li>
          ))}
          {visible.length === 0 && <li className="px-2 py-3 text-sm text-muted-foreground">Nada encontrado para “{q}”.</li>}
        </ul>
      )}
    </fieldset>
  );
}
