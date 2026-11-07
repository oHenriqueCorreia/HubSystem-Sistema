"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormField } from "@/components/app/form-field";
import { createAdClient, deleteAdClient, renameAdClient } from "../actions";
import { PROVIDER_NAME } from "../filters";
import type { AdAccount, AdClient } from "../queries";

export type SystemClientOption = { id: string; name: string };

const NO_SYSTEM_CLIENT = "__sem_vinculo__";

/** Liga o grupo de contas ao cliente do sistema: quem trabalha nele passa a ver estes anúncios. */
function SystemClientField({ value, onChange, options, taken }: { value: string | null; onChange: (v: string | null) => void; options: SystemClientOption[]; taken: string[] }) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        Cliente no sistema <span className="font-normal text-muted-foreground">(opcional)</span>
      </Label>
      <Select value={value ?? NO_SYSTEM_CLIENT} onValueChange={(v) => onChange(v === NO_SYSTEM_CLIENT ? null : v)}>
        <SelectTrigger id={id} className="w-full" aria-describedby={`${id}-hint`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_SYSTEM_CLIENT}>Sem vínculo</SelectItem>
          {options
            .filter((o) => o.id === value || !taken.includes(o.id))
            .map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        Quem trabalha nesse cliente (Equipe do cliente ou squad) passa a ver estes anúncios, dentro das permissões do papel.
      </p>
    </div>
  );
}

/** Novo cliente com as contas que pertencem a ele (só contas ainda sem cliente). */
export function NewClientDialog({ accounts, systemClients = [], taken = [] }: { accounts: AdAccount[]; systemClients?: SystemClientOption[]; taken?: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [systemClientId, setSystemClientId] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const free = accounts.filter((a) => !a.ad_client_id).sort((a, b) => Number(b.is_selected) - Number(a.is_selected) || a.name.localeCompare(b.name));

  function save() {
    startTransition(async () => {
      const res = await createAdClient({ name, accountIds: picked, systemClientId });
      if (!res.ok) return void setError(res.message);
      toast.success(res.message);
      setOpen(false);
      setName("");
      setPicked([]);
      setSystemClientId(null);
      setError(undefined);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden="true" /> Novo cliente
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo cliente</DialogTitle>
          <DialogDescription>Agrupe as contas de anúncio de um cliente para ver o painel dele. Contas sem relatório ativado são ativadas na tela Contas.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <FormField label="Nome do cliente" error={error} required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" placeholder="Ex.: Mattos Pneus…" />
          </FormField>
          {systemClients.length > 0 && <SystemClientField value={systemClientId} onChange={setSystemClientId} options={systemClients} taken={taken} />}
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Contas de anúncio</legend>
            {free.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todas as contas já têm cliente. Você pode trocar o cliente de uma conta em Contas.</p>
            ) : (
              <ul className="grid max-h-72 gap-1 overflow-y-auto rounded-lg border p-2">
                {free.map((a) => (
                  <li key={a.id}>
                    <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                      <Checkbox checked={picked.includes(a.id)} onCheckedChange={(v) => setPicked((p) => (v ? [...p, a.id] : p.filter((x) => x !== a.id)))} />
                      <span className="min-w-0 flex-1 truncate">{a.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {PROVIDER_NAME[a.provider]}
                        {a.is_selected ? "" : " (fora dos relatórios)"}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Criar cliente
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Editar (nome e vínculo) e excluir um cliente (as contas continuam conectadas). */
export function ClientActions({ client, systemClients = [], taken = [] }: { client: AdClient; systemClients?: SystemClientOption[]; taken?: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(client.name);
  const [systemClientId, setSystemClientId] = useState<string | null>(client.client_id);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex gap-1">
      <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Editar ${client.name}`}>
            <Pencil aria-hidden="true" />
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar cliente</DialogTitle>
            <DialogDescription>O nome aparece no filtro e no painel do cliente.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const res = await renameAdClient({ id: client.id, name, systemClientId });
                if (!res.ok) return void setError(res.message);
                toast.success(res.message);
                setOpen(false);
                router.refresh();
              });
            }}
          >
            <FormField label="Nome do cliente" error={error} required>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" />
            </FormField>
            {systemClients.length > 0 && <SystemClientField value={systemClientId} onChange={setSystemClientId} options={systemClients} taken={taken} />}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar cliente
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="icon-sm" aria-label={`Excluir ${client.name}`}>
            <Trash2 aria-hidden="true" />
          </Button>
        }
        title={`Excluir o cliente ${client.name}?`}
        description="As contas de anúncio continuam conectadas e com os dados; só deixam de estar agrupadas neste cliente."
        confirmLabel="Excluir cliente"
        onConfirm={async () => {
          const res = await deleteAdClient({ id: client.id });
          if (res.ok) toast.success(res.message);
          else toast.error(res.message);
          router.refresh();
        }}
      />
    </div>
  );
}
