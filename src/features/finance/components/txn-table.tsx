"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BadgeCheck, CircleCheck, CircleDashed, ListChecks, MoreHorizontal, Repeat } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MoneyInput } from "@/components/app/money-input";
import { formatBRL } from "@/domain/shared/money";
import { formatDate, todayLocal } from "@/domain/shared/dates";
import { isOverdueTxn } from "@/domain/finance";
import { CHARGE_REASON_LABEL } from "@/domain/finance/charge";
import { cn } from "cn";
import { cancelTransaction, deleteTransaction, markPaid, markUnpaid, restoreTransaction, setReconciled } from "../actions";
import type { Account, Category, CostCenter, FinanceScope, Transaction } from "../types";
import { TxnFormDialog } from "./txn-form-dialog";
import { Attachments } from "@/features/clients/components/attachments";
import { ChargeDialog, HistoryDialog, TransferDialog } from "./txn-extra-dialogs";
import { BulkBar } from "./bulk-actions";

type Lookups = { accounts: Account[]; categories: Category[]; costCenters: CostCenter[] };

function StatusBadge({ t, today }: { t: Transaction; today: string }) {
  if (t.status === "cancelado")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <CircleDashed className="size-3.5" aria-hidden="true" /> Cancelado
      </span>
    );
  if (t.status === "pago")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        {t.reconciled_at ? <BadgeCheck className="size-3.5" aria-hidden="true" /> : <CircleCheck className="size-3.5" aria-hidden="true" />}
        {t.kind === "receita" ? "Recebido" : t.kind === "despesa" ? "Pago" : "Transferido"} {t.paid_at && formatDate(t.paid_at)}
        {t.reconciled_at && " · conciliado"}
      </span>
    );
  if (isOverdueTxn(t, today))
    return (
      <span className="inline-flex items-center gap-1 rounded border border-danger/40 bg-danger-soft px-1.5 py-0.5 text-xs font-medium text-danger">
        <AlarmClock className="size-3.5" aria-hidden="true" /> Vencido
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <CircleDashed className="size-3.5" aria-hidden="true" /> {t.due_date === today ? "Vence hoje" : "A vencer"}
    </span>
  );
}

export function TxnTable({ scope, rows, lookups, perms }: { scope: FinanceScope; rows: Transaction[]; lookups: Lookups; perms: { update: boolean; delete: boolean; reconcile: boolean; transfer?: boolean; recurring?: boolean } }) {
  const canBulk = Boolean(perms.delete || perms.transfer);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  // Trocar de filtro ou de página tira da conta o que não está mais na tela.
  const selectedRows = useMemo(() => rows.filter((t) => selected.has(t.id)), [rows, selected]);
  const toggle = (id: string, on: boolean) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const selectAll = (on: boolean) => setSelected(new Set(on ? rows.map((t) => t.id) : []));
  const clearSelection = () => {
    setSelected(new Set());
    setSelecting(false);
  };
  const [transferring, setTransferring] = useState<Transaction | null>(null);
  const [charging, setCharging] = useState<Transaction | null>(null);
  const [history, setHistory] = useState<Transaction | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [paying, setPaying] = useState<Transaction | null>(null);
  const [receipts, setReceipts] = useState<Transaction | null>(null);
  const [payDate, setPayDate] = useState(todayLocal());
  const [payAmount, setPayAmount] = useState<number | null>(null);
  const [payAccount, setPayAccount] = useState<string>("");
  const today = todayLocal();
  const cat = new Map(lookups.categories.map((c) => [c.id, c.name]));
  const acc = new Map(lookups.accounts.map((a) => [a.id, a.name]));

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, undo?: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.message);
      toast.success(res.message, undo ? { action: { label: "Desfazer", onClick: async () => { const r = await undo(); if (r.ok) router.refresh(); else toast.error(r.message); } } } : undefined);
    });
  }

  function openPay(t: Transaction) {
    setPaying(t);
    setPayDate(today);
    setPayAmount(t.amount_cents);
    setPayAccount(t.account_id ?? lookups.accounts.find((a) => a.is_active)?.id ?? "");
  }

  const KindIcon = ({ t }: { t: Transaction }) =>
    t.kind === "receita" ? (
      <ArrowDownLeft className="size-4 text-success" aria-label="Receita" />
    ) : t.kind === "despesa" ? (
      <ArrowUpRight className="size-4 text-danger" aria-label="Despesa" />
    ) : (
      <ArrowLeftRight className="size-4 text-info" aria-label="Transferência" />
    );

  const amount = (t: Transaction) => {
    const v = t.status === "pago" ? (t.paid_amount_cents ?? t.amount_cents) : t.amount_cents;
    const sign = t.kind === "receita" ? "+" : t.kind === "despesa" ? "−" : "";
    return (
      <span className={cn("tabular font-medium whitespace-nowrap", t.kind === "receita" && "text-success", t.kind === "despesa" && "text-foreground", t.status === "cancelado" && "text-muted-foreground line-through")}>
        {sign} {formatBRL(v)}
      </span>
    );
  };

  const actions = (t: Transaction) => (
    <div className="flex items-center justify-end gap-1">
      {perms.update && t.status === "previsto" && t.kind !== "transferencia" && (
        <Button size="sm" variant="outline" onClick={() => openPay(t)}>
          {t.kind === "receita" ? "Receber" : "Pagar"}
        </Button>
      )}
      {perms.reconcile && t.status === "pago" && (
        <label className="flex items-center gap-1 text-xs" title="Conferido no extrato">
          <Checkbox checked={Boolean(t.reconciled_at)} onCheckedChange={(v) => run(() => setReconciled({ id: t.id, reconciled: Boolean(v) }))} aria-label={`Conciliar ${t.description}`} />
          <span className="hidden lg:inline">Conciliado</span>
        </label>
      )}
      {(perms.update || perms.delete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={`Mais ações para ${t.description}`}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {perms.update && (
              <TxnFormDialog scope={scope} lookups={lookups} txn={t} trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()}>Editar</DropdownMenuItem>} />
            )}
            <DropdownMenuItem onSelect={() => setReceipts(t)}>Comprovantes e anexos</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setHistory(t)}>Histórico</DropdownMenuItem>
            {perms.update && t.kind === "receita" && t.status === "previsto" && <DropdownMenuItem onSelect={() => setCharging(t)}>Cobrar por WhatsApp</DropdownMenuItem>}
            {perms.transfer && t.kind !== "transferencia" && <DropdownMenuItem onSelect={() => setTransferring(t)}>Transferir para {scope === "empresa" ? "o pessoal" : "a empresa"}</DropdownMenuItem>}
            {perms.update && t.status === "pago" && t.kind !== "transferencia" && <DropdownMenuItem onSelect={() => run(() => markUnpaid({ id: t.id }))}>Voltar para em aberto</DropdownMenuItem>}
            {perms.update && t.status === "previsto" && <DropdownMenuItem onSelect={() => run(() => cancelTransaction({ id: t.id }))}>Cancelar lançamento</DropdownMenuItem>}
            {perms.delete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-danger" onSelect={() => run(() => deleteTransaction({ id: t.id }), () => restoreTransaction({ id: t.id }))}>
                  Excluir
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );

  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border bg-surface md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {canBulk && (
                <TableHead className="w-8">
                  <Checkbox checked={allSelected} onCheckedChange={(v) => selectAll(v === true)} aria-label="Selecionar todos desta página" />
                </TableHead>
              )}
              <TableHead className="w-8">
                <span className="sr-only">Tipo</span>
              </TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Conta</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((t) => (
              <TableRow key={t.id} data-state={selected.has(t.id) ? "selected" : undefined} className={cn(isOverdueTxn(t, today) && "bg-danger-soft/40")}>
                {canBulk && (
                  <TableCell>
                    <Checkbox checked={selected.has(t.id)} onCheckedChange={(v) => toggle(t.id, v === true)} aria-label={`Selecionar ${t.description}`} />
                  </TableCell>
                )}
                <TableCell>
                  <KindIcon t={t} />
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(t.due_date)}</TableCell>
                <TableCell className="max-w-72">
                  <span className="flex items-center gap-1 font-medium">
                    {t.recurrence_id && <Repeat className="size-3.5 shrink-0 text-muted-foreground" aria-label="Recorrente" />}
                    <span className="truncate">{t.description}</span>
                  </span>
                  {(t.client?.lead?.name || t.counterparty) && <span className="block truncate text-xs text-muted-foreground">{t.client?.lead?.name ?? t.counterparty}</span>}
                  {t.charge_reason && <span className="block truncate text-xs text-muted-foreground">{CHARGE_REASON_LABEL[t.charge_reason]}{t.charge_note ? `: ${t.charge_note}` : ""}</span>}
                </TableCell>
                <TableCell className="text-sm">{t.category_id ? cat.get(t.category_id) : "—"}</TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  {t.account_id ? acc.get(t.account_id) : "—"}
                  {t.transfer_account_id && ` → ${acc.get(t.transfer_account_id)}`}
                </TableCell>
                <TableCell className="text-right">{amount(t)}</TableCell>
                <TableCell>
                  <StatusBadge t={t} today={today} />
                </TableCell>
                <TableCell>{actions(t)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {canBulk && rows.length > 0 && (
        <div className="flex items-center justify-between gap-2 md:hidden">
          <Button variant="outline" aria-pressed={selecting} onClick={() => (selecting ? clearSelection() : setSelecting(true))}>
            <ListChecks aria-hidden="true" /> {selecting ? "Cancelar seleção" : "Selecionar vários"}
          </Button>
          {selecting && (
            <Button variant="ghost" onClick={() => selectAll(!allSelected)}>
              {allSelected ? "Desmarcar todos" : "Marcar todos"}
            </Button>
          )}
        </div>
      )}

      <ul className={cn("grid gap-2 md:hidden", selectedRows.length > 0 && "pb-24")}>
        {rows.map((t) => (
          <li key={t.id} className={cn("grid min-w-0 gap-2 rounded-lg border bg-surface p-3", isOverdueTxn(t, today) && "border-danger/40", selected.has(t.id) && "border-primary ring-1 ring-primary")}>
            <div className={cn("grid min-w-0 items-start gap-2", selecting ? "grid-cols-[auto_auto_minmax(0,1fr)]" : "grid-cols-[auto_minmax(0,1fr)]")}>
              {selecting && <Checkbox checked={selected.has(t.id)} onCheckedChange={(v) => toggle(t.id, v === true)} aria-label={`Selecionar ${t.description}`} />}
              <KindIcon t={t} />
              <span className="min-w-0 break-words text-sm font-medium">{t.description}</span>
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t pt-2">
              <span className="min-w-0 flex-1 break-words text-xs text-muted-foreground">
                {formatDate(t.due_date)} · {t.category_id ? cat.get(t.category_id) : "Sem categoria"}
              </span>
              <span className="ml-auto text-right">{amount(t)}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatusBadge t={t} today={today} />
              {actions(t)}
            </div>
          </li>
        ))}
      </ul>

      {selectedRows.length > 0 && <BulkBar rows={selectedRows} scope={scope} perms={perms} onClear={clearSelection} />}

      {transferring && <TransferDialog canRecur={Boolean(perms.recurring)} txn={transferring} scope={scope} categoryName={transferring.category_id ? cat.get(transferring.category_id) : undefined} accountName={transferring.account_id ? acc.get(transferring.account_id) : undefined} onClose={() => setTransferring(null)} />}
      {charging && <ChargeDialog txn={charging} scope={scope} onClose={() => setCharging(null)} />}
      {history && <HistoryDialog txn={history} onClose={() => setHistory(null)} />}

      <Dialog open={Boolean(receipts)} onOpenChange={(v) => !v && setReceipts(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Comprovantes</DialogTitle>
            <DialogDescription>{receipts?.description}</DialogDescription>
          </DialogHeader>
          {receipts && <Attachments key={receipts.id} entityType="transaction" entityId={receipts.id} title="Arquivos do lançamento" canUpload={perms.update} />}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(paying)} onOpenChange={(v) => !v && setPaying(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{paying?.kind === "receita" ? "Confirmar recebimento" : "Registrar pagamento"}</DialogTitle>
            <DialogDescription>Confira o comprovante e os dados. O valor conta uma única vez, na área {scope === "empresa" ? "da empresa" : "pessoal"}.</DialogDescription>
          </DialogHeader>
          {paying && (
            <dl className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Lançamento</dt>
                <dd className="font-medium break-words">{paying.description}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Valor previsto</dt>
                <dd className="tabular">{formatBRL(paying.amount_cents)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Vencimento</dt>
                <dd>{formatDate(paying.due_date)}</dd>
              </div>
              {(paying.client?.lead?.name || paying.counterparty) && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">{paying.kind === "receita" ? "Cliente" : "Fornecedor"}</dt>
                  <dd className="break-words">{paying.client?.lead?.name ?? paying.counterparty}</dd>
                </div>
              )}
            </dl>
          )}
          {paying && <Attachments key={paying.id} entityType="transaction" entityId={paying.id} title="Comprovante (imagem ou PDF)" canUpload={perms.update} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pay-date">Data</Label>
              <Input id="pay-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pay-amount">Valor {paying?.kind === "receita" ? "recebido" : "pago"}</Label>
              <MoneyInput id="pay-amount" value={payAmount} onChange={setPayAmount} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="pay-account">Conta</Label>
              <Select value={payAccount} onValueChange={setPayAccount}>
                <SelectTrigger id="pay-account" className="w-full">
                  <SelectValue placeholder="Escolha a conta" />
                </SelectTrigger>
                <SelectContent>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaying(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!payDate || payAmount == null}
              onClick={() => {
                if (!paying || payAmount == null) return;
                const t = paying;
                setPaying(null);
                run(() => markPaid({ id: t.id, paidAt: payDate, paidAmountCents: payAmount, accountId: payAccount || null }), () => markUnpaid({ id: t.id }));
              }}
            >
              {paying?.kind === "receita" ? "Confirmar recebimento e dar baixa" : "Confirmar pagamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
