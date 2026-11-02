"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormField } from "@/components/app/form-field";
import { createAdClient, deleteAdClient, renameAdClient } from "../actions";
import { PROVIDER_NAME } from "../filters";
import type { AdAccount, AdClient } from "../queries";

/** Novo cliente com as contas que pertencem a ele (só contas ainda sem cliente). */
export function NewClientDialog({ accounts }: { accounts: AdAccount[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const free = accounts.filter((a) => !a.ad_client_id).sort((a, b) => Number(b.is_selected) - Number(a.is_selected) || a.name.localeCompare(b.name));

  function save() {
    startTransition(async () => {
      const res = await createAdClient({ name, accountIds: picked });
      if (!res.ok) return void setError(res.message);
      toast.success(res.message);
      setOpen(false);
      setName("");
      setPicked([]);
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
          <DialogDescription>Agrupe as contas de anúncio de um cliente para ver o painel dele. Contas sem relatório ativado são ativadas na tela Contas e alertas.</DialogDescription>
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
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Contas de anúncio</legend>
            {free.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todas as contas já têm cliente. Você pode trocar o cliente de uma conta em Contas e alertas.</p>
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

/** Renomear e excluir um cliente (as contas continuam conectadas). */
export function ClientActions({ client }: { client: AdClient }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(client.name);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex gap-1">
      <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Renomear ${client.name}`}>
            <Pencil aria-hidden="true" />
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Renomear cliente</DialogTitle>
            <DialogDescription>O nome aparece no filtro e no painel do cliente.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const res = await renameAdClient({ id: client.id, name });
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
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar nome
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
