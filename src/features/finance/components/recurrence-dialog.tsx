"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormAlert, FormField } from "@/components/app/form-field";
import { MoneyInput } from "@/components/app/money-input";
import { formatDate, todayLocal } from "@/domain/shared/dates";
import { upcomingDueDates } from "@/domain/finance/business-days";
import { createRecurrence, saveCategory } from "../actions";
import { SCOPE_LABEL, type Account, type Category, type FinanceScope } from "../types";

const NONE = "__nenhum__";
const FREQ = [
  ["mensal", "Todo mês"],
  ["trimestral", "A cada 3 meses"],
  ["semestral", "A cada 6 meses"],
  ["anual", "Todo ano"],
] as const;
type Frequency = (typeof FREQ)[number][0];

/** Nova conta fixa: dia do mês ou N-ésimo dia útil, com prévia dos próximos vencimentos. */
export function RecurrenceDialog({ scope, accounts, categories }: { scope: FinanceScope; accounts: Account[]; categories: Category[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"despesa" | "receita">("despesa");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState(NONE);
  const [accountId, setAccountId] = useState(NONE);
  const [frequency, setFrequency] = useState<Frequency>("mensal");
  const [rule, setRule] = useState<"dia_fixo" | "dia_util">("dia_util");
  const [day, setDay] = useState(5);
  const [startMonth, setStartMonth] = useState(() => todayLocal().slice(0, 7));
  const [endDate, setEndDate] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const options = categories.filter((c) => c.kind === kind && c.is_active);
  const maxDay = rule === "dia_util" ? 23 : 31;
  const validDay = Number.isInteger(day) && day >= 1 && day <= maxDay;
  const today = todayLocal();
  // Vencimentos que já passaram não são criados: a série começa no próximo a partir de hoje.
  const preview = /^\d{4}-\d{2}$/.test(startMonth) && validDay ? upcomingDueDates({ startMonth, frequency, rule, day, count: 16 }).filter((d) => d >= today).slice(0, 4) : [];

  function addCategory() {
    const name = newCategory.trim();
    if (name.length < 2) return void setErrors((e) => ({ ...e, newCategory: "Use ao menos 2 letras." }));
    startTransition(async () => {
      const res = await saveCategory({ scope, name, kind, parentId: null, isActive: true });
      if (!res.ok) return void setErrors((e) => ({ ...e, newCategory: res.message }));
      toast.success(`Tipo “${name}” criado. Escolha-o na lista.`);
      setNewCategory("");
      setErrors((e) => ({ ...e, newCategory: "" }));
      router.refresh();
    });
  }

  function save() {
    startTransition(async () => {
      const res = await createRecurrence({
        scope,
        kind,
        description,
        amountCents: amount ?? 0,
        categoryId: categoryId === NONE ? null : categoryId,
        accountId: accountId === NONE ? null : accountId,
        frequency,
        dueRule: rule,
        dueDay: rule === "dia_fixo" ? day : 10,
        businessDay: rule === "dia_util" ? day : 5,
        startMonth,
        endDate: endDate || null,
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ? Object.fromEntries(Object.entries(res.fieldErrors).map(([k, v]) => [k, v[0]])) : { form: res.message });
        return;
      }
      toast.success(res.message);
      setOpen(false);
      setDescription("");
      setAmount(null);
      setErrors({});
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden="true" /> Nova conta fixa
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nova conta fixa ({SCOPE_LABEL[scope].toLowerCase()})</DialogTitle>
          <DialogDescription>Mensalidades, aluguel, salários, assinaturas: algo que se repete. Os vencimentos dos próximos 12 meses entram nas contas a pagar e no Início.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {errors.form && <FormAlert>{errors.form}</FormAlert>}
          <ToggleGroup type="single" variant="outline" value={kind} onValueChange={(v) => v && (setKind(v as typeof kind), setCategoryId(NONE))} aria-label="Tipo de lançamento" className="justify-self-start">
            <ToggleGroupItem value="despesa">Despesa (pagar)</ToggleGroupItem>
            <ToggleGroupItem value="receita">Receita (receber)</ToggleGroupItem>
          </ToggleGroup>

          <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
            <FormField label="Descrição" error={errors.description} required>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} autoComplete="off" placeholder="Ex.: Mensalidade do contador…" />
            </FormField>
            <FormField label="Valor" error={errors.amountCents} required>
              <MoneyInput value={amount} onChange={setAmount} />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={kind === "despesa" ? "Tipo de despesa" : "Tipo de receita"} optional>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem tipo</SelectItem>
                  {options.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Criar novo tipo" hint="Aparece também em Contas e categorias." error={errors.newCategory || undefined} optional>
              <div className="flex gap-2">
                <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} maxLength={80} autoComplete="off" placeholder="Ex.: Software…" />
                <Button type="button" variant="outline" onClick={addCategory} disabled={pending}>
                  Criar
                </Button>
              </div>
            </FormField>
          </div>

          {accounts.length > 0 && (
            <FormField label="Conta de pagamento" optional>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Definir depois</SelectItem>
                  {accounts
                    .filter((a) => a.is_active)
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </FormField>
          )}

          <fieldset className="grid gap-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">Vencimento</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Repetição">
                <Select value={frequency} onValueChange={(v) => setFrequency(v as Frequency)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQ.map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Primeiro mês" error={errors.startMonth} required>
                <Input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
              </FormField>
            </div>
            <ToggleGroup
              type="single"
              variant="outline"
              value={rule}
              onValueChange={(v) => {
                if (!v) return;
                setRule(v as typeof rule);
                setDay(v === "dia_util" ? 5 : 10);
              }}
              aria-label="Regra de vencimento"
              className="justify-self-start"
            >
              <ToggleGroupItem value="dia_util">Dia útil do mês</ToggleGroupItem>
              <ToggleGroupItem value="dia_fixo">Dia fixo do mês</ToggleGroupItem>
            </ToggleGroup>
            <FormField
              label={rule === "dia_util" ? "Qual dia útil" : "Dia do mês"}
              hint={rule === "dia_util" ? "Ex.: 5 = 5º dia útil (segunda a sexta, sem feriados nacionais e bancários)." : "Em meses mais curtos, vence no último dia."}
              error={errors.businessDay ?? errors.dueDay ?? (validDay ? undefined : `Use um número de 1 a ${maxDay}.`)}
              required
            >
              <Input type="number" inputMode="numeric" min={1} max={maxDay} value={Number.isNaN(day) ? "" : day} onChange={(e) => setDay(e.target.valueAsNumber)} className="w-28" />
            </FormField>
            <p className="text-sm" aria-live="polite">
              <span className="text-muted-foreground">Próximos vencimentos: </span>
              {preview.length ? preview.map(formatDate).join(", ") : "—"}
            </p>
          </fieldset>

          <FormField label="Termina em" hint="Deixe em branco se não tem data para acabar." error={errors.endDate} optional>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-48" />
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Criar conta fixa
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
