"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormAlert, FormField } from "@/components/app/form-field";
import { MoneyInput } from "@/components/app/money-input";
import { formatBRL, splitInstallments } from "@/domain/shared/money";
import { todayLocal } from "@/domain/shared/dates";
import { PAYMENT_LABEL } from "@/features/clients/types";
import { issuesToMap } from "@/features/clients/components/contract-fields";
import { cn } from "cn";
import { createTransaction, updateTransaction } from "../actions";
import { txnFormSchema, txnUpdateSchema, type TxnFormValues } from "../schemas";
import { SCOPE_LABEL, type Account, type Category, type CostCenter, type FinanceScope, type Transaction, type TxnKind } from "../types";

const NONE = "__nenhum__";

type Lookups = { accounts: Account[]; categories: Category[]; costCenters: CostCenter[]; contracts?: { id: string; title: string; clientId: string | null; clientName: string }[] };

export function TxnFormDialog({ scope, lookups, trigger, defaultKind = "despesa", txn }: { scope: FinanceScope; lookups: Lookups; trigger: ReactNode; defaultKind?: TxnKind; txn?: Transaction }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const activeAccounts = lookups.accounts.filter((a) => a.is_active);
  const today = todayLocal();

  const initial = (): TxnFormValues => ({
    scope,
    kind: txn?.kind ?? defaultKind,
    description: txn?.description ?? "",
    amountCents: txn?.amount_cents ?? (undefined as unknown as number),
    categoryId: txn?.category_id ?? null,
    accountId: txn?.account_id ?? activeAccounts[0]?.id ?? null,
    transferAccountId: txn?.transfer_account_id ?? null,
    costCenterId: txn?.cost_center_id ?? null,
    paymentMethod: txn?.payment_method ?? null,
    competenceDate: txn?.competence_date ?? today,
    dueDate: txn?.due_date ?? today,
    paid: false,
    paidAt: today,
    paidAmountCents: null,
    installments: 1,
    recurrence: "nenhuma",
    recurrenceEnd: null,
    clientId: txn?.client_id ?? null,
    contractId: txn?.contract_id ?? null,
    notes: txn?.notes ?? "",
  });
  const [v, setV] = useState<TxnFormValues>(initial);
  const [applyFuture, setApplyFuture] = useState(false);
  const set = <K extends keyof TxnFormValues>(k: K, val: TxnFormValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const kind = v.kind;
  const categories = lookups.categories.filter((c) => c.is_active && c.kind === kind);

  function submit() {
    setError(null);
    if (txn) {
      const payload = {
        id: txn.id,
        description: v.description,
        amountCents: v.amountCents,
        categoryId: v.categoryId,
        accountId: v.accountId,
        costCenterId: v.costCenterId,
        paymentMethod: v.paymentMethod,
        competenceDate: v.competenceDate,
        dueDate: v.dueDate,
        notes: v.notes,
        applyToFuture: applyFuture,
      };
      const parsed = txnUpdateSchema.safeParse(payload);
      if (!parsed.success) return setErrors(issuesToMap(parsed.error.issues));
      setErrors({});
      startTransition(async () => {
        const res = await updateTransaction(payload);
        if (!res.ok) return void setError(res.message);
        toast.success(res.message);
        setOpen(false);
        router.refresh();
      });
      return;
    }
    const parsed = txnFormSchema.safeParse(v);
    if (!parsed.success) return setErrors(issuesToMap(parsed.error.issues));
    setErrors({});
    startTransition(async () => {
      const res = await createTransaction(v);
      if (!res.ok) return void setError(res.message);
      toast.success(res.message);
      setOpen(false);
      setV(initial());
      router.refresh();
    });
  }

  const preview = !txn && v.installments && v.installments > 1 && v.amountCents ? splitInstallments(v.amountCents, v.installments) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className={cn("max-h-[92dvh] overflow-y-auto border-l-4 sm:max-w-xl", scope === "pessoal" ? "border-l-ctx-personal" : "border-l-ctx-company")}>
        <DialogHeader>
          <DialogTitle>
            {txn ? "Editar lançamento" : "Novo lançamento"} · {SCOPE_LABEL[scope]}
          </DialogTitle>
          <DialogDescription>
            {scope === "pessoal" ? "Financeiro pessoal: separado da empresa e visível só para você e o administrador." : "Financeiro da empresa. Alterações de valores ficam na auditoria."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormAlert>{error}</FormAlert>
          {!txn && (
            <ToggleGroup type="single" value={kind} onValueChange={(k) => k && setV((p) => ({ ...p, kind: k as TxnKind, categoryId: null }))} variant="outline" aria-label="Tipo de lançamento">
              <ToggleGroupItem value="receita">Receita</ToggleGroupItem>
              <ToggleGroupItem value="despesa">Despesa</ToggleGroupItem>
              <ToggleGroupItem value="transferencia">Transferência</ToggleGroupItem>
            </ToggleGroup>
          )}
          <FormField label="Descrição" error={errors.description} required>
            <Input value={v.description} onChange={(e) => set("description", e.target.value)} placeholder={kind === "receita" ? "Ex.: Site — Vidraçaria Sol" : kind === "despesa" ? "Ex.: Hospedagem" : "Ex.: Reserva"} autoFocus />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={v.installments && v.installments > 1 ? "Valor total" : "Valor"} error={errors.amountCents} required>
              <MoneyInput value={v.amountCents} onChange={(c) => set("amountCents", c as number)} />
            </FormField>
            <FormField label={v.installments && v.installments > 1 ? "1º vencimento" : "Vencimento"} error={errors.dueDate} required>
              <Input type="date" value={v.dueDate} onChange={(e) => setV((p) => ({ ...p, dueDate: e.target.value, competenceDate: p.competenceDate === p.dueDate ? e.target.value : p.competenceDate }))} />
            </FormField>
            {kind !== "transferencia" && (
              <FormField label="Categoria" error={errors.categoryId}>
                <Select value={v.categoryId ?? NONE} onValueChange={(c) => set("categoryId", c === NONE ? null : c)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem categoria</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
            <FormField label={kind === "transferencia" ? "De (origem)" : "Conta"} error={errors.accountId}>
              <Select value={v.accountId ?? NONE} onValueChange={(c) => set("accountId", c === NONE ? null : c)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kind !== "transferencia" && <SelectItem value={NONE}>Definir depois</SelectItem>}
                  {activeAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {kind === "transferencia" && (
              <FormField label="Para (destino)" error={errors.transferAccountId} required>
                <Select value={v.transferAccountId ?? NONE} onValueChange={(c) => set("transferAccountId", c === NONE ? null : c)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Escolha a conta" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeAccounts
                      .filter((a) => a.id !== v.accountId)
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          </div>

          {!txn && kind !== "transferencia" && (
            <div className="grid gap-3 rounded-lg border bg-muted/40 p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Switch checked={v.paid} onCheckedChange={(p) => set("paid", p)} /> {kind === "receita" ? "Já recebido" : "Já pago"}
              </label>
              {v.paid && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Data do pagamento" error={errors.paidAt} required>
                    <Input type="date" value={v.paidAt ?? ""} onChange={(e) => set("paidAt", e.target.value || null)} />
                  </FormField>
                  <FormField label="Valor pago" hint="Se diferente (juros, desconto)." optional>
                    <MoneyInput value={v.paidAmountCents ?? null} onChange={(c) => set("paidAmountCents", c)} />
                  </FormField>
                </div>
              )}
            </div>
          )}
          {kind === "transferencia" && !txn && (
            <FormField label="Data da transferência">
              <Input type="date" value={v.paidAt ?? today} onChange={(e) => set("paidAt", e.target.value || null)} />
            </FormField>
          )}

          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" className="group -ml-2 justify-start">
                <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" /> Parcelas, recorrência e mais opções
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 grid gap-3 sm:grid-cols-2">
              {!txn && kind !== "transferencia" && (
                <>
                  <FormField label="Parcelas" hint="Divide o total em parcelas mensais." error={errors.installments}>
                    <Input type="number" min={1} max={120} value={v.installments} onChange={(e) => set("installments", Math.max(1, Number(e.target.value) || 1))} />
                  </FormField>
                  <FormField label="Repetir" error={errors.recurrence}>
                    <Select value={v.recurrence} onValueChange={(r) => set("recurrence", r as TxnFormValues["recurrence"])}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nenhuma">Não repetir</SelectItem>
                        <SelectItem value="semanal">Toda semana</SelectItem>
                        <SelectItem value="mensal">Todo mês</SelectItem>
                        <SelectItem value="trimestral">A cada 3 meses</SelectItem>
                        <SelectItem value="semestral">A cada 6 meses</SelectItem>
                        <SelectItem value="anual">Todo ano</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormField>
                  {v.recurrence !== "nenhuma" && (
                    <FormField label="Repetir até" hint="Vazio = sem fim (gera 12 meses à frente)." optional>
                      <Input type="date" value={v.recurrenceEnd ?? ""} onChange={(e) => set("recurrenceEnd", e.target.value || null)} />
                    </FormField>
                  )}
                  {preview && (
                    <p className="text-xs text-muted-foreground sm:col-span-2" role="status">
                      {v.installments} parcelas: {formatBRL(preview[0])}
                      {preview[0] !== preview[preview.length - 1] ? ` (última ${formatBRL(preview[preview.length - 1])})` : ""}
                    </p>
                  )}
                </>
              )}
              <FormField label="Competência" hint="Mês a que o valor pertence (DRE)." error={errors.competenceDate}>
                <Input type="date" value={v.competenceDate} onChange={(e) => set("competenceDate", e.target.value)} />
              </FormField>
              <FormField label="Forma de pagamento" optional>
                <Select value={v.paymentMethod ?? NONE} onValueChange={(p) => set("paymentMethod", p === NONE ? null : (p as TxnFormValues["paymentMethod"]))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Não informada</SelectItem>
                    {Object.entries(PAYMENT_LABEL).map(([k, l]) => (
                      <SelectItem key={k} value={k}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              {scope === "empresa" && lookups.costCenters.length > 0 && (
                <FormField label="Centro de custo" optional>
                  <Select value={v.costCenterId ?? NONE} onValueChange={(c) => set("costCenterId", c === NONE ? null : c)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Nenhum</SelectItem>
                      {lookups.costCenters
                        .filter((c) => c.is_active)
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
              {scope === "empresa" && !txn && lookups.contracts && lookups.contracts.length > 0 && (
                <FormField label="Contrato / cliente" optional>
                  <Select
                    value={v.contractId ?? NONE}
                    onValueChange={(c) => {
                      const k = lookups.contracts!.find((x) => x.id === c);
                      setV((p) => ({ ...p, contractId: c === NONE ? null : c, clientId: k?.clientId ?? null }));
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Nenhum</SelectItem>
                      {lookups.contracts.map((k) => (
                        <SelectItem key={k.id} value={k.id}>
                          {k.clientName ? `${k.clientName} — ` : ""}
                          {k.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
              <FormField label="Observações" optional className="sm:col-span-2">
                <Textarea rows={2} value={v.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
              </FormField>
              {txn?.recurrence_id && (
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <Switch checked={applyFuture} onCheckedChange={setApplyFuture} /> Aplicar também às próximas ocorrências em aberto
                </label>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {txn ? "Salvar lançamento" : "Lançar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
