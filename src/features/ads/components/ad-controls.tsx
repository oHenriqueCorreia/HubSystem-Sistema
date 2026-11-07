"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, LoaderCircle, MoreHorizontal, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormField } from "@/components/app/form-field";
import { MoneyInput } from "@/components/app/money-input";
import { formatMoney } from "../format";
import { duplicateAdEntity, renameAdEntity, setAdBudget, setAdStatus } from "../manage-actions";

export type EditTarget = { level: "campaign" | "adset" | "ad"; id: string; name: string; provider: "meta_ads" | "google_ads"; currency: string };

const NOUN = { campaign: "a campanha", adset: "o conjunto", ad: "o anúncio" } as const;
const ACTIVE = new Set(["ACTIVE", "ENABLED"]);
const EDITABLE = new Set(["ACTIVE", "ENABLED", "PAUSED"]);

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) =>
    new Promise<boolean>((resolve) =>
      start(async () => {
        const res = await fn();
        if (res.ok) {
          toast.success(res.message);
          after?.();
        } else toast.error(res.message);
        router.refresh();
        resolve(res.ok);
      }),
    );
  return { pending, run };
}

/** Liga e pausa, com confirmação: a mudança vale na hora na plataforma. */
export function StatusSwitch({ target, status }: { target: EditTarget; status: string | null }) {
  const { pending, run } = useAction();
  const active = ACTIVE.has(status ?? "");
  // Status herdados (campanha pausada, em análise, reprovado) não se mudam por aqui.
  if (!EDITABLE.has(status ?? "")) return null;
  return (
    <ConfirmDialog
      trigger={
        <span className="inline-flex">
          <Switch checked={active} disabled={pending} aria-label={`${active ? "Pausar" : "Ativar"} ${target.name}`} />
        </span>
      }
      title={active ? `Pausar ${NOUN[target.level]}?` : `Ativar ${NOUN[target.level]}?`}
      description={
        <>
          <strong className="font-medium text-foreground">{target.name}</strong> {active ? "para de veicular" : "volta a veicular e a gastar"} agora no {target.provider === "meta_ads" ? "Meta Ads" : "Google Ads"}.
        </>
      }
      confirmLabel={active ? "Pausar" : "Ativar"}
      tone={active ? "danger" : "default"}
      onConfirm={() => run(() => setAdStatus({ level: target.level, id: target.id, active: !active }))}
    />
  );
}

/** Orçamento diário: mostra o valor; ao editar, confirma o antigo e o novo. */
export function BudgetCell({ target, budget }: { target: EditTarget & { level: "campaign" | "adset" }; budget: number | null }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<number | null>(budget);
  const { pending, run } = useAction();
  const money = (c: number) => formatMoney(c, target.currency);
  // Sem orçamento próprio (fica na campanha ou no conjunto): só exibe.
  if (budget == null) return <span className="text-muted-foreground">—</span>;
  const changed = value != null && value !== budget;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setValue(budget);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 rounded px-1 tabular hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={`Editar orçamento de ${target.name}: ${money(budget)}`}
      >
        {money(budget)}
        <Pencil className="size-3 text-muted-foreground" aria-hidden="true" />
      </button>
      <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Orçamento diário</DialogTitle>
            <DialogDescription className="break-words">{target.name}</DialogDescription>
          </DialogHeader>
          <FormField label="Novo orçamento por dia" hint={`Atual: ${money(budget)}. Vale na hora no ${target.provider === "meta_ads" ? "Meta Ads" : "Google Ads"}.`}>
            <MoneyInput value={value} onChange={setValue} autoFocus />
          </FormField>
          {changed && (
            <p className="rounded-lg bg-muted p-3 text-sm">
              {money(budget)} → <strong className="font-semibold">{money(value!)}</strong> por dia ({value! > budget ? "+" : "−"}
              {Math.abs(Math.round(((value! - budget) / budget) * 100))}%)
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button disabled={pending || !changed} onClick={() => run(() => setAdBudget({ level: target.level, id: target.id, dailyBudgetCents: value! }), () => setOpen(false))}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar orçamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Renomear e duplicar. */
export function RowMenu({ target }: { target: EditTarget }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(target.name);
  const { pending, run } = useAction();
  const canRename = target.provider === "meta_ads" || target.level === "campaign";
  const canDuplicate = target.provider === "meta_ads" && target.level !== "ad";
  if (!canRename && !canDuplicate) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" aria-label={`Mais ações para ${target.name}`} disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <MoreHorizontal aria-hidden="true" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canRename && (
            <DropdownMenuItem
              onSelect={() => {
                setName(target.name);
                setRenaming(true);
              }}
            >
              <Pencil aria-hidden="true" /> Renomear
            </DropdownMenuItem>
          )}
          {canDuplicate && (
            <DropdownMenuItem onSelect={() => run(() => duplicateAdEntity({ level: target.level as "campaign" | "adset", id: target.id }))}>
              <Copy aria-hidden="true" /> Duplicar (nasce pausada)
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={renaming} onOpenChange={(v) => !pending && setRenaming(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Renomear</DialogTitle>
            <DialogDescription>O nome muda também na plataforma.</DialogDescription>
          </DialogHeader>
          <FormField label="Nome">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={250} autoComplete="off" autoFocus />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button disabled={pending || !name.trim() || name.trim() === target.name} onClick={() => run(() => renameAdEntity({ level: target.level, id: target.id, name }), () => setRenaming(false))}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar nome
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
