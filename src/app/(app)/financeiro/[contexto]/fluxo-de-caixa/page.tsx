import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL } from "@/domain/shared/money";
import { formatDate, todayLocal } from "@/domain/shared/dates";
import { addMonthsCivil, cashFlow } from "@/domain/finance";
import { MONTH_LABEL, monthBounds, requireFinance } from "@/features/finance/server";
import { getSummary, listFlow } from "@/features/finance/queries";
import { CashFlowCharts } from "@/features/finance/components/cash-flow-charts";

export const metadata: Metadata = { title: "Fluxo de caixa" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" && v ? v : undefined;
}

export default async function FluxoPage({ params, searchParams }: PageProps<"/financeiro/[contexto]/fluxo-de-caixa">) {
  const { contexto } = await params;
  const { scope } = await requireFinance(contexto);
  const sp = await searchParams;
  const today = todayLocal();
  const from = str(sp.de) ?? monthBounds(addMonthsCivil(today, -2)).from;
  const to = str(sp.ate) ?? monthBounds(addMonthsCivil(today, 3)).to;
  const group = str(sp.agrupar) === "dia" ? "dia" : "mes";

  // Saldo inicial = saldo atual − realizado do início do período até hoje.
  const [flow, summary] = await Promise.all([listFlow(scope, from, to), getSummary(scope, from, today)]);
  const realizedSinceStart = flow
    .filter((t) => t.status === "pago" && t.paid_at && t.paid_at <= today && t.kind !== "transferencia")
    .reduce((s, t) => s + (t.kind === "receita" ? 1 : -1) * (t.paid_amount_cents ?? t.amount_cents), 0);
  const opening = summary.balance - realizedSinceStart;
  const rows = cashFlow(flow, group, opening);
  const label = (p: string) => (group === "mes" ? MONTH_LABEL(p) : formatDate(p).slice(0, 5));
  const totals = rows.reduce(
    (a, r) => ({ income: a.income + r.income + r.incomeForecast, expense: a.expense + r.expense + r.expenseForecast }),
    { income: 0, expense: 0 },
  );

  return (
    <div className="grid gap-6">
      <form className="flex flex-wrap items-end gap-3" aria-label="Período do fluxo de caixa">
        <div className="grid gap-1">
          <Label htmlFor="fc-de" className="text-xs">
            De
          </Label>
          <Input id="fc-de" name="de" type="date" defaultValue={from} className="w-40" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="fc-ate" className="text-xs">
            Até
          </Label>
          <Input id="fc-ate" name="ate" type="date" defaultValue={to} className="w-40" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="fc-agrupar" className="text-xs">
            Agrupar por
          </Label>
          <select id="fc-agrupar" name="agrupar" defaultValue={group} className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="mes">Mês</option>
            <option value="dia">Dia</option>
          </select>
        </div>
        <Button type="submit" variant="outline">
          Atualizar
        </Button>
      </form>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-surface p-4">
          <dt className="text-xs text-muted-foreground">Saldo no início ({formatDate(from)})</dt>
          <dd className="tabular text-xl font-semibold">{formatBRL(opening)}</dd>
        </div>
        <div className="rounded-xl border bg-surface p-4">
          <dt className="text-xs text-muted-foreground">Entradas (realizadas + previstas)</dt>
          <dd className="tabular text-xl font-semibold">{formatBRL(totals.income)}</dd>
        </div>
        <div className="rounded-xl border bg-surface p-4">
          <dt className="text-xs text-muted-foreground">Saídas (realizadas + previstas)</dt>
          <dd className="tabular text-xl font-semibold">{formatBRL(totals.expense)}</dd>
        </div>
        <div className="rounded-xl border bg-surface p-4">
          <dt className="text-xs text-muted-foreground">Saldo projetado ({formatDate(to)})</dt>
          <dd className={`tabular text-xl font-semibold ${rows.at(-1) && rows.at(-1)!.balance < 0 ? "text-danger" : ""}`}>{formatBRL(rows.at(-1)?.balance ?? opening)}</dd>
        </div>
      </dl>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma movimentação no período.</p>
      ) : (
        <CashFlowCharts
          rows={rows.map((r) => ({
            periodo: label(r.period),
            receitas: r.income,
            receitasPrev: r.incomeForecast,
            despesas: r.expense,
            despesasPrev: r.expenseForecast,
            liquido: r.net,
            saldo: r.balance,
          }))}
        />
      )}
    </div>
  );
}
