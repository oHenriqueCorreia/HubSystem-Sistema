import type { Metadata } from "next";
import { Suspense } from "react";
import { formatDate } from "@/domain/shared/dates";
import { requireFinance } from "@/features/finance/server";
import { getLookups, getOpenInPeriod, getSummary, listFlow } from "@/features/finance/queries";
import { FINANCE_PRESETS, resolvePeriod } from "@/features/dashboards/period";
import { DashboardFilters } from "@/features/dashboards/components/dashboard-filters";
import { Stat } from "@/features/finance/components/stat";
import { FinanceDashboardCharts } from "@/features/finance/components/finance-dashboard";

export const metadata: Metadata = { title: "Dashboard financeiro" };

export default async function FinanceDashboardPage({ params, searchParams }: { params: Promise<{ contexto: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { contexto } = await params;
  const { scope } = await requireFinance(contexto);
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const category = typeof sp.categoria === "string" && /^[0-9a-f-]{36}$/i.test(sp.categoria) ? sp.categoria : "";
  const [summary, open, flow, lookups] = await Promise.all([getSummary(scope, period.from, period.to), getOpenInPeriod(scope, period.from, period.to, period.today), listFlow(scope, period.from, period.to), getLookups(scope)]);
  const rows = category ? flow.filter((t) => t.category_id === category) : flow;
  const sum = (kind: string, status: string) => rows.filter((t) => t.kind === kind && t.status === status).reduce((a, t) => a + Number(status === "pago" ? (t.paid_amount_cents ?? t.amount_cents) : t.amount_cents), 0);
  const received = category ? sum("receita", "pago") : summary.income_paid;
  const paid = category ? sum("despesa", "pago") : summary.expense_paid;
  const receivable = category ? sum("receita", "previsto") : open.receivable + summary.receivable_overdue;
  const payable = category ? sum("despesa", "previsto") : open.payable + summary.payable_overdue;

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <Suspense>
          <DashboardFilters preset={period.preset} from={period.from} to={period.to} presets={FINANCE_PRESETS} storageKey={`hub:financeiro-dashboard-${scope}`} />
        </Suspense>
        <form action={`/financeiro/${scope}/dashboard`} className="flex flex-wrap items-center gap-2 text-sm">
          {Object.entries(sp).map(([k, v]) => (k !== "categoria" && typeof v === "string" ? <input key={k} type="hidden" name={k} value={v} /> : null))}
          <label htmlFor="categoria-filtro">Categoria</label>
          <select id="categoria-filtro" name="categoria" defaultValue={category} className="h-9 max-w-full rounded-md border bg-background px-2 text-foreground">
            <option value="">Todas</option>
            {lookups.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.kind === "receita" ? "entrada" : "saída"})
              </option>
            ))}
          </select>
          <button type="submit" className="h-9 rounded-md border bg-surface px-3 font-medium hover:bg-accent">
            Aplicar
          </button>
        </form>
        <p className="text-sm text-muted-foreground">
          {period.from === period.to ? formatDate(period.from) : `${formatDate(period.from)} a ${formatDate(period.to)}`}. {scope === "empresa" ? "Somente lançamentos da empresa." : "Somente seus lançamentos pessoais."}
        </p>
      </div>

      <section aria-labelledby="efetivos" className="grid gap-2">
        <h2 id="efetivos" className="text-sm font-semibold">
          Efetivo
        </h2>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat label="Entradas recebidas" cents={received} />
          <Stat label="Saídas pagas" cents={paid} />
          <Stat label="Saldo atual das contas" cents={summary.balance} tone="negative" hint={category ? "Saldo não é filtrado por categoria." : undefined} />
        </dl>
      </section>
      <section aria-labelledby="pendentes" className="grid gap-2">
        <h2 id="pendentes" className="text-sm font-semibold">
          Pendente
        </h2>
        <dl className="grid grid-cols-2 gap-3">
          <Stat label="A receber" cents={receivable} hint={category ? undefined : `${open.receivableCount} no período, mais os vencidos`} />
          <Stat label="A pagar" cents={payable} hint={category ? undefined : `${open.payableCount} no período, mais os vencidos`} />
        </dl>
      </section>
      <FinanceDashboardCharts rows={rows} categories={lookups.categories.map((c) => ({ id: c.id, name: c.name }))} />
    </div>
  );
}
