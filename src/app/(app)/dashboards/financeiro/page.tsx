import type { Metadata } from "next";
import { LiveRefresh } from "@/components/app/live-refresh";
import Link from "next/link";
import { Suspense } from "react";
import { AlarmClock } from "lucide-react";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/domain/shared/dates";
import { addMonthsCivil, cashFlow } from "@/domain/finance";
import { getLookups, getOpenInPeriod, getSummary, listFlow, prepareScope } from "@/features/finance/queries";
import { MONTH_LABEL } from "@/features/finance/server";
import { FINANCE_PRESETS, resolvePeriod } from "@/features/dashboards/period";
import { DashboardFilters } from "@/features/dashboards/components/dashboard-filters";
import { DashboardTabs } from "@/features/dashboards/components/dashboard-tabs";
import { Kpi } from "@/features/dashboards/components/kpi";
import { DonutRank } from "@/features/dashboards/components/commercial-charts";
import { FinanceRings } from "@/features/finance/components/finance-dashboard";
import { MonthlyChart } from "@/features/finance/components/monthly-chart";
import { CashFlowCharts } from "@/features/finance/components/cash-flow-charts";
import type { FinanceScope } from "@/features/finance/types";

export const metadata: Metadata = { title: "Dashboard financeiro" };

export default async function FinanceiroDashboard({ searchParams }: PageProps<"/dashboards/financeiro">) {
  const user = await requirePermission("dashboards.financial");
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const canCompany = Boolean(user.permissions["finance.company.read"]);
  const canPersonal = Boolean(user.permissions["finance.personal.manage"]);
  const requested = sp.contexto === "pessoal" ? "pessoal" : "empresa";
  const scope: FinanceScope = requested === "pessoal" && canPersonal ? "pessoal" : canCompany ? "empresa" : "pessoal";
  await prepareScope(scope);

  const forecastTo = addMonthsCivil(period.today, 3);
  const twelveAgo = `${addMonthsCivil(period.today, -11).slice(0, 7)}-01`;
  const [cur, prev, flowYear, flowPeriod, flowForecast, lookups, open] = await Promise.all([
    getSummary(scope, period.from, period.to),
    getSummary(scope, period.prevFrom, period.prevTo),
    listFlow(scope, twelveAgo, period.to),
    listFlow(scope, period.from, period.to),
    listFlow(scope, period.today, forecastTo),
    getLookups(scope),
    getOpenInPeriod(scope, period.from, period.to, period.today),
  ]);

  const result = cur.income_paid - cur.expense_paid;
  const resultPrev = prev.income_paid - prev.expense_paid;
  const monthly = cashFlow(flowYear, "mes").map((r) => ({ mes: MONTH_LABEL(r.period), receitas: r.income, despesas: r.expense, receitasPrev: r.incomeForecast, despesasPrev: r.expenseForecast }));
  const forecast = cashFlow(flowForecast.filter((t) => t.status === "previsto"), "mes", cur.balance).map((r) => ({
    periodo: MONTH_LABEL(r.period),
    receitas: r.income,
    receitasPrev: r.incomeForecast,
    despesas: r.expense,
    despesasPrev: r.expenseForecast,
    liquido: r.net,
    saldo: r.balance,
  }));

  const catName = new Map(lookups.categories.map((c) => [c.id, c.name]));
  const byCategory = (kind: "receita" | "despesa") => {
    const m = new Map<string, number>();
    for (const t of flowPeriod) {
      if (t.kind !== kind) continue;
      const k = t.category_id ? (catName.get(t.category_id) ?? "Outra") : "Sem categoria";
      m.set(k, (m.get(k) ?? 0) + (t.status === "pago" ? (t.paid_amount_cents ?? t.amount_cents) : t.amount_cents));
    }
    const rows = [...m.entries()].sort((a, b) => b[1] - a[1]);
    // Mais de 8 categorias: o restante vira "Outras" (nunca uma cor gerada).
    const top = rows.slice(0, 8).map(([name, amount]) => ({ name, amount }));
    const rest = rows.slice(8).reduce((s, [, a]) => s + a, 0);
    return rest ? [...top, { name: "Outras", amount: rest }] : top;
  };

  return (
    <>
      <PageHeader
        accent={scope === "empresa" ? "company" : "personal"}
        breadcrumbs={[{ label: "Análise" }, { label: "Financeiro" }]}
        title={`Dashboard financeiro · ${scope === "empresa" ? "Empresa" : "Pessoal"}`}
        description={`${formatDate(period.from)} a ${formatDate(period.to)}. Comparação com ${formatDate(period.prevFrom)}–${formatDate(period.prevTo)}.`}
      />
      <PageBody className="grid gap-6">
        <LiveRefresh intervalMs={60_000} />
        <DashboardTabs commercial={Boolean(user.permissions["dashboards.commercial"])} financial />
        <Suspense>
          <DashboardFilters
            preset={period.preset}
            from={period.from}
            to={period.to}
            presets={FINANCE_PRESETS}
            storageKey="hub:dashboard-financeiro-periodo"
            extra={
              canCompany && canPersonal
                ? [{ name: "contexto", label: "Contexto", value: scope, options: [["empresa", "Empresa"], ["pessoal", "Pessoal"]] }]
                : undefined
            }
          />
        </Suspense>

        {cur.overdue_count > 0 && (
          <p className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger" role="status">
            <AlarmClock className="size-4" aria-hidden="true" /> {cur.overdue_count} conta(s) vencida(s).
            <Link href={`/financeiro/${scope}/lancamentos?situacao=vencidos`} className="underline">
              Ver vencidos
            </Link>
          </p>
        )}

        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Receitas do período" value={cur.income_competence} previous={prev.income_competence} money hint="Recebidas e a receber" />
          <Kpi label="Despesas do período" value={cur.expense_competence} previous={prev.expense_competence} money invert hint="Pagas e a pagar" />
          <Kpi label="Resultado previsto" value={cur.income_competence - cur.expense_competence} previous={prev.income_competence - prev.expense_competence} money />
          <Kpi label="Saldo atual" value={cur.balance} money />
          <Kpi label="Receitas recebidas" value={cur.income_paid} previous={prev.income_paid} money />
          <Kpi label="Despesas pagas" value={cur.expense_paid} previous={prev.expense_paid} money invert />
          <Kpi label="Resultado realizado" value={result} previous={resultPrev} money />
          <Kpi label="A receber no período" value={open.receivable} money hint={`${open.receivableCount} em aberto`} />
          <Kpi label="A pagar no período" value={open.payable} money hint={`${open.payableCount} em aberto`} />
          <Kpi label="Recebimentos vencidos" value={cur.receivable_overdue} money invert />
          <Kpi label="Pagamentos vencidos" value={cur.payable_overdue} money invert />
        </dl>

        <div className="rounded-xl border bg-surface p-4">
          <FinanceRings rows={flowPeriod} />
        </div>
        <MonthlyChart rows={monthly} title="Resultado mensal" description="Últimos 12 meses: realizado em cor cheia, previsto tracejado." />
        <div className="grid gap-4 lg:grid-cols-2">
          <DonutRank title="Despesas por categoria" description="Pagas e a pagar no período." rows={byCategory("despesa")} money labelHeader="Categoria" centerLabel="Despesas" />
          <DonutRank title="Receitas por categoria" description="Recebidas e a receber no período." rows={byCategory("receita")} money labelHeader="Categoria" centerLabel="Receitas" />
        </div>
        <section aria-labelledby="previsao" className="grid gap-2">
          <h2 id="previsao" className="text-sm font-semibold">
            Previsão financeira (próximos 3 meses)
          </h2>
          {forecast.length === 0 ? <p className="text-sm text-muted-foreground">Nada previsto para os próximos meses.</p> : <CashFlowCharts rows={forecast} />}
        </section>
      </PageBody>
    </>
  );
}
