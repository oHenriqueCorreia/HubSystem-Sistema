"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSignature, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { generateReceivables } from "../actions";
import type { Account, Category } from "../types";

const NONE = "__nenhum__";

/** Gera as contas a receber de um contrato (únicas ou recorrentes). */
export function ReceivablesDialog({
  contracts,
  lookups,
  defaultContract,
}: {
  contracts: { id: string; title: string; clientName: string }[];
  lookups: { accounts: Account[]; categories: Category[] };
  defaultContract?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [contract, setContract] = useState(defaultContract ?? "");
  const [account, setAccount] = useState(lookups.accounts.find((a) => a.is_active)?.id ?? NONE);
  const [category, setCategory] = useState(NONE);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <FileSignature aria-hidden="true" /> Gerar cobranças de contrato
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gerar cobranças de contrato</DialogTitle>
          <DialogDescription>Cria as contas a receber previstas. Contratos recorrentes geram os próximos 12 meses e continuam automaticamente.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="rc-contract">Contrato</Label>
            <Select value={contract} onValueChange={setContract}>
              <SelectTrigger id="rc-contract" className="w-full">
                <SelectValue placeholder="Escolha o contrato" />
              </SelectTrigger>
              <SelectContent>
                {contracts.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.clientName ? `${k.clientName} — ` : ""}
                    {k.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rc-account">Conta de recebimento</Label>
            <Select value={account} onValueChange={setAccount}>
              <SelectTrigger id="rc-account" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Definir depois</SelectItem>
                {lookups.accounts
                  .filter((a) => a.is_active)
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rc-category">Categoria</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="rc-category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sem categoria</SelectItem>
                {lookups.categories
                  .filter((c) => c.kind === "receita" && c.is_active)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!contract || pending}
            onClick={() =>
              startTransition(async () => {
                const res = await generateReceivables({ contractId: contract, accountId: account === NONE ? null : account, categoryId: category === NONE ? null : category });
                if (!res.ok) return void toast.error(res.message);
                toast.success(res.message);
                setOpen(false);
                router.refresh();
              })
            }
          >
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Gerar cobranças
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
