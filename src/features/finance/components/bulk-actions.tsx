"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowRightLeft, LoaderCircle, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormAlert, FormField } from "@/components/app/form-field";
import { formatBRL } from "@/domain/shared/money";
import { bulkTransferBlock, canRepeatMonthly } from "@/domain/finance/bulk";
import { bulkDeleteTransactions, bulkRestoreTransactions, bulkTransferTransactions, getTransferOptions } from "../ops-actions";
import { SCOPE_LABEL, type Account, type Category, type FinanceScope, type Transaction } from "../types";

const NONE = "__nenhuma__";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Barra que aparece ao marcar lançamentos: mover de área ou excluir vários de uma vez. */
export function BulkBar({ rows, scope, perms, onClear }: { rows: Transaction[]; scope: FinanceScope; perms: { delete: boolean; transfer?: boolean; recurring?: boolean }; onClear: () => void }) {
  const router = useRouter();
  const [moving, setMoving] = useState(false);
  const to: FinanceScope = scope === "empresa" ? "pessoal" : "empresa";
  const total = rows.reduce((sum, t) => sum + (t.kind === "receita" ? 1 : t.kind === "despesa" ? -1 : 0) * Number(t.status === "pago" ? (t.paid_amount_cents ?? t.amount_cents) : t.amount_cents), 0);

  async function remove() {
    const ids = rows.map((t) => t.id);
    const res = await bulkDeleteTransactions({ ids });
    if (!res.ok) {
      toast.error(res.message);
      return false;
    }
    toast.success(res.message, {
      action: {
        label: "Desfazer",
        onClick: async () => {
          const r = await bulkRestoreTransactions({ ids: res.data.deleted });
          if (r.ok) router.refresh();
          else toast.error(r.message);
        },
      },
    });
    onClear();
    router.refresh();
  }

  return (
    <>
      <div role="region" aria-label="Ações nos lançamentos selecionados" className="fixed inset-x-2 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border bg-popover p-2 shadow-lg md:sticky md:inset-x-auto md:bottom-3 md:mt-3 md:flex md:flex-wrap">
        <p className="min-w-0 pl-1 text-sm md:flex-1" aria-live="polite">
          <strong className="font-semibold">{count(rows.length, "selecionado", "selecionados")}</strong>
          <span className="block text-xs text-muted-foreground tabular sm:ml-2 sm:inline">Saldo {formatBRL(total)}</span>
        </p>
        <Button variant="ghost" size="icon" aria-label="Limpar seleção" onClick={onClear} className="md:order-last">
          <X aria-hidden="true" />
        </Button>
        <div className="col-span-2 flex flex-wrap gap-2 md:contents [&>*]:max-md:flex-auto">
        {perms.transfer && (
          <Button variant="outline" onClick={() => setMoving(true)}>
            <ArrowRightLeft aria-hidden="true" /> Mover para {to === "empresa" ? "a empresa" : "o pessoal"}
          </Button>
        )}
        {perms.delete && (
          <ConfirmDialog
            trigger={
              <Button variant="outline" className="text-danger">
                <Trash2 aria-hidden="true" /> Excluir
              </Button>
            }
            title={`Excluir ${count(rows.length, "lançamento", "lançamentos")}?`}
            description="Eles saem dos saldos e relatórios. Logo depois de excluir, dá para desfazer pelo aviso na tela."
            confirmLabel="Excluir"
            onConfirm={remove}
          />
        )}
        </div>
      </div>
      {moving && <BulkTransferDialog rows={rows} scope={scope} canRecur={Boolean(perms.recurring)} onClose={() => setMoving(false)} onDone={onClear} />}
    </>
  );
}

function BulkTransferDialog({ rows, scope, canRecur, onClose, onDone }: { rows: Transaction[]; scope: FinanceScope; canRecur: boolean; onClose: () => void; onDone: () => void }) {
  const router = useRouter();
  const to: FinanceScope = scope === "empresa" ? "pessoal" : "empresa";
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [revenueCategory, setRevenueCategory] = useState(NONE);
  const [expenseCategory, setExpenseCategory] = useState(NONE);
  const [accountId, setAccountId] = useState(NONE);
  const [recurring, setRecurring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ description: string; reason: string }[]>([]);
  const [pending, startTransition] = useTransition();

  const { eligible, blocked } = useMemo(() => {
    const ok: Transaction[] = [];
    const no: { t: Transaction; reason: string }[] = [];
    for (const t of rows) {
      const reason = bulkTransferBlock(t);
      if (reason) no.push({ t, reason });
      else ok.push(t);
    }
    return { eligible: ok, blocked: no };
  }, [rows]);
  const hasRevenue = eligible.some((t) => t.kind === "receita");
  const hasExpense = eligible.some((t) => t.kind === "despesa");
  const needsAccount = eligible.some((t) => t.status === "pago");
  const repeatable = eligible.filter(canRepeatMonthly);
  const showRecurring = scope === "pessoal" && canRecur && repeatable.length > 0;

  useEffect(() => {
    let alive = true;
    void getTransferOptions({ to }).then((res) => {
      if (!alive) return;
      if (!res.ok) return setError(res.message);
      setAccounts(res.data.accounts);
      setCategories(res.data.categories);
      setAccountId(res.data.accounts[0]?.id ?? NONE);
    });
    return () => {
      alive = false;
    };
  }, [to]);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await bulkTransferTransactions({
        ids: eligible.map((t) => t.id),
        revenueCategoryId: revenueCategory === NONE ? null : revenueCategory,
        expenseCategoryId: expenseCategory === NONE ? null : expenseCategory,
        accountId: accountId === NONE ? null : accountId,
        recurring: showRecurring && recurring,
      });
      if (!res.ok) return setError(res.message ?? "Não foi possível mover.");
      router.refresh();
      if (res.data.failed.length) {
        // O que deu certo já mudou de área: fica na tela só o que precisa de atenção.
        setFailed(res.data.failed);
        if (res.data.moved) toast.success(res.message);
        return;
      }
      toast.success(res.message);
      onDone();
      onClose();
    });
  }

  const categorySelect = (label: string, value: string, set: (v: string) => void, kind: "receita" | "despesa") => (
    <FormField label={label} optional>
      <Select value={value} onValueChange={set}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Sem categoria</SelectItem>
          {categories
            .filter((c) => c.kind === kind)
            .map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </FormField>
  );

  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {SCOPE_LABEL[scope]} <ArrowRight className="size-4" aria-hidden="true" /> {SCOPE_LABEL[to]}
          </DialogTitle>
          <DialogDescription>
            {eligible.length > 0 ? `${count(eligible.length, "lançamento sai", "lançamentos saem")} ${scope === "pessoal" ? "do pessoal" : "da empresa"} e ${eligible.length === 1 ? "vai" : "vão"} para ${to === "empresa" ? "a empresa" : "o pessoal"}, com anexos e histórico. Nada é duplicado.` : "Nenhum dos selecionados pode ser movido."}
          </DialogDescription>
        </DialogHeader>
        <FormAlert>{error}</FormAlert>
        {failed.length > 0 && (
          <div role="alert" className="grid gap-1 rounded-lg border border-danger/40 bg-danger-soft p-3 text-sm">
            <p className="font-medium">{count(failed.length, "lançamento não foi movido", "lançamentos não foram movidos")}:</p>
            <ul className="grid gap-1">
              {failed.map((f, i) => (
                <li key={`${f.description}-${i}`} className="break-words">
                  <strong className="font-medium">{f.description}:</strong> {f.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        {blocked.length > 0 && (
          <div className="grid gap-1 rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-medium">{count(blocked.length, "fica de fora", "ficam de fora")}:</p>
            <ul className="grid max-h-28 gap-1 overflow-y-auto">
              {blocked.map(({ t, reason }) => (
                <li key={t.id} className="break-words text-muted-foreground">
                  {t.description}: {reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        {eligible.length > 0 &&
          (accounts === null && !error ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <div className="grid gap-3">
              {hasRevenue && categorySelect(`Categoria das receitas em ${SCOPE_LABEL[to]}`, revenueCategory, setRevenueCategory, "receita")}
              {hasExpense && categorySelect(`Categoria das despesas em ${SCOPE_LABEL[to]}`, expenseCategory, setExpenseCategory, "despesa")}
              <FormField label={`Conta em ${SCOPE_LABEL[to]}`} required={needsAccount} optional={!needsAccount} hint={needsAccount ? "O que já foi pago entra no saldo desta conta." : undefined}>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {!needsAccount && <SelectItem value={NONE}>Sem conta</SelectItem>}
                    {(accounts ?? []).map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              {showRecurring && (
                <label className="flex min-w-0 items-start gap-3 rounded-lg border p-3 text-sm">
                  <Checkbox className="mt-0.5" checked={recurring} onCheckedChange={(v) => setRecurring(v === true)} />
                  <span>
                    <strong className="block font-medium">Virar receita recorrente na empresa</strong>
                    <span className="text-xs text-muted-foreground">{count(repeatable.length, "receita passa", "receitas passam")} a se repetir todo mês, a partir do vencimento. Despesas só mudam de área.</span>
                  </span>
                </label>
              )}
            </div>
          ))}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {failed.length ? "Fechar" : "Cancelar"}
          </Button>
          {eligible.length > 0 && !failed.length && (
            <Button disabled={pending || accounts === null || (needsAccount && accountId === NONE)} onClick={confirm}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Mover {count(eligible.length, "lançamento", "lançamentos")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
