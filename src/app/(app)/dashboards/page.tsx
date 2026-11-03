import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowUpRight, CalendarDays, CheckSquare2, CircleDollarSign, ContactRound, Repeat, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/domain/shared/dates";
import { addMonthsCivil, cashFlow } from "@/domain/finance";
import { getSummary, listFlow, prepareScope } from "@/features/finance/queries";
import { MONTH_LABEL } from "@/features/finance/server";
import type { FinanceScope } from "@/features/finance/types";
import { resolvePeriod } from "@/features/dashboards/period";
import { DashboardFilters } from "@/features/dashboards/components/dashboard-filters";
import { DashboardTabs } from "@/features/dashboards/components/dashboard-tabs";
import { Kpi } from "@/features/dashboards/components/kpi";
import { DonutRank, SalesByMonth } from "@/features/dashboards/components/commercial-charts";
import { FinanceRings } from "@/features/finance/components/finance-dashboard";
import { DonutCard } from "@/components/app/round-charts";
import { getLookups } from "@/features/finance/queries";
import { MonthlyChart } from "@/features/finance/components/monthly-chart";

export const metadata: Metadata = { title: "Visão geral" };

type CommercialOverview = {
  total_leads: number;
  new_leads: number;
  by_stage: { name: string; count: number; amount: number }[];
  by_month: { month: string; amount: number }[];
  won: number;
  revenue: number;
};

function AreaLink({ href, icon: Icon, title, value, detail }: { href: string; icon: typeof UsersRound; title: string; value: string; detail: string }) {
  return (
    <Link href={href} className="group grid gap-2 rounded-xl border bg-surface p-4 transition-colors hover:border-primary/40 hover:bg-primary/5">
      <span className="flex items-center justify-between text-primary"><Icon className="size-5" aria-hidden="true" /><ArrowUpRight className="size-4 opacity-50 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" /></span>
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      <span className="text-xl font-semibold tabular tracking-tight">{value}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </Link>
  );
}

export default async function DashboardsPage({ searchParams }: PageProps<"/dashboards">) {
  const user = await requireUser();
  const canCommercial = Boolean(user.permissions["dashboards.commercial"]);
  const canFinancial = Boolean(user.permissions["dashboards.financial"]);
  if (!canCommercial && !canFinancial) redirect("/sem-acesso");

  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const supabase = await createClient();
  const financeScope: FinanceScope | null = canFinancial
    ? user.permissions["finance.company.read"] ? "empresa" : user.permissions["finance.personal.manage"] ? "pessoal" : null
    : null;

  const commercialQuery = canCommercial
    ? supabase.rpc("commercial_dashboard", {
        p_from: period.from,
        p_to: period.to,
        p_owner: user.permissions["dashboards.commercial"] === "own" ? user.id : null,
        p_pipeline: null,
      })
    : Promise.resolve({ data: null, error: null });
  const financeQuery = financeScope
    ? (async () => {
        await prepareScope(financeScope);
        const flowFrom = `${addMonthsCivil(period.to, -11).slice(0, 7)}-01`;
        const [summary, flow, inPeriod, lookups] = await Promise.all([getSummary(financeScope, period.from, period.to), listFlow(financeScope, flowFrom, period.to), listFlow(financeScope, period.from, period.to), getLookups(financeScope)]);
        return { summary, flow, inPeriod, lookups };
      })()
    : Promise.resolve(null);

  const emptyCount = Promise.resolve({ count: 0, error: null });
  const [commercialResult, finance, tasksOpen, tasksLate, clients, events, cadences] = await Promise.all([
    commercialQuery,
    financeQuery,
    user.permissions["tasks.read"] ? supabase.from("tasks").select("id", { count: "exact", head: true }).is("deleted_at", null).in("status", ["a_fazer", "em_andamento"]) : emptyCount,
    user.permissions["tasks.read"] ? supabase.from("tasks").select("id", { count: "exact", head: true }).is("deleted_at", null).in("status", ["a_fazer", "em_andamento"]).lt("due_at", new Date().toISOString()) : emptyCount,
    user.permissions["clients.read"] ? supabase.from("clients").select("id", { count: "exact", head: true }).is("deleted_at", null) : emptyCount,
    user.permissions["calendar.read"] ? supabase.from("calendar_events").select("id", { count: "exact", head: true }).is("deleted_at", null).gte("starts_at", `${period.from}T00:00:00-03:00`).lte("starts_at", `${period.to}T23:59:59-03:00`) : emptyCount,
    user.permissions["crm.cadences.read"] ? supabase.from("cadence_templates").select("id", { count: "exact", head: true }).eq("is_active", true) : emptyCount,
  ]);
  for (const result of [commercialResult, tasksOpen, tasksLate, clients, events, cadences]) if (result.error) throw result.error;

  const commercial = commercialResult.data as CommercialOverview | null;
  const financial = finance?.summary ?? null;
  const byCategory = (kind: "receita" | "despesa") => {
    const names = new Map((finance?.lookups.categories ?? []).map((c) => [c.id, c.name]));
    const totals = new Map<string, number>();
    for (const t of finance?.inPeriod ?? []) {
      if (t.kind !== kind) continue;
      const name = (t.category_id && names.get(t.category_id)) || "Sem categoria";
      totals.set(name, (totals.get(name) ?? 0) + Number(t.status === "pago" ? (t.paid_amount_cents ?? t.amount_cents) : t.amount_cents));
    }
    return [...totals.entries()].map(([name, value]) => ({ name, value }));
  };
  const monthly = finance ? cashFlow(finance.flow, "mes").map((row) => ({ mes: MONTH_LABEL(row.period), receitas: row.income, despesas: row.expense, receitasPrev: row.incomeForecast, despesasPrev: row.expenseForecast })) : [];

  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Análise" }, { label: "Visão geral" }]} title="Visão geral" description={`O que está acontecendo no HubSystem de ${formatDate(period.from)} a ${formatDate(period.to)}.`} />
      <PageBody className="grid gap-6">
        <DashboardTabs commercial={canCommercial} financial={canFinancial} />
        <Suspense><DashboardFilters preset={period.preset} from={period.from} to={period.to} /></Suspense>

        <section aria-labelledby="panorama" className="grid gap-3">
          <div><h2 id="panorama" className="text-base font-semibold">Panorama do período</h2><p className="text-sm text-muted-foreground">Indicadores calculados com os dados que seu papel pode consultar.</p></div>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {commercial && <Kpi label="Leads no sistema" value={commercial.total_leads} hint={`${commercial.new_leads} novo(s) no período`} />}
            {commercial && <Kpi label="Negócios fechados" value={commercial.won} />}
            {commercial && <Kpi label="Receita comercial" value={commercial.revenue} money hint="Contratos iniciados no período" />}
            {financial && <Kpi label={`Saldo ${financeScope === "pessoal" ? "pessoal" : "da empresa"}`} value={financial.balance} money />}
            {financial && <Kpi label="Receitas recebidas" value={financial.income_paid} money />}
            {financial && <Kpi label="Despesas pagas" value={financial.expense_paid} money />}
            {user.permissions["tasks.read"] && <Kpi label="Tarefas em aberto" value={tasksOpen.count ?? 0} hint={`${tasksLate.count ?? 0} atrasada(s)`} />}
            {user.permissions["calendar.read"] && <Kpi label="Eventos na agenda" value={events.count ?? 0} hint="No período selecionado" />}
          </dl>
        </section>

        <section aria-labelledby="areas" className="grid gap-3">
          <h2 id="areas" className="text-base font-semibold">Acompanhe cada área</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {canCommercial && <AreaLink href="/crm/funil" icon={UsersRound} title="Comercial" value={String(commercial?.total_leads ?? 0)} detail="Leads e negócios no funil" />}
            {user.permissions["clients.read"] && <AreaLink href="/clientes" icon={ContactRound} title="Clientes" value={String(clients.count ?? 0)} detail="Clientes no cadastro" />}
            {user.permissions["tasks.read"] && <AreaLink href="/tarefas" icon={CheckSquare2} title="Trabalho" value={String(tasksOpen.count ?? 0)} detail={`${tasksLate.count ?? 0} tarefa(s) atrasada(s)`} />}
            {user.permissions["calendar.read"] && <AreaLink href="/agenda" icon={CalendarDays} title="Agenda" value={String(events.count ?? 0)} detail="Compromissos no período" />}
            {user.permissions["crm.cadences.read"] && <AreaLink href="/crm/cadencias" icon={Repeat} title="Cadências" value={String(cadences.count ?? 0)} detail="Roteiros ativos" />}
            {financeScope && <AreaLink href={`/financeiro/${financeScope}`} icon={CircleDollarSign} title={`Financeiro ${financeScope}`} value={financial ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(financial.balance / 100) : "—"} detail="Saldo atual" />}
          </div>
        </section>

        {commercial && (
          <section aria-labelledby="grafico-comercial" className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="grafico-comercial" className="text-base font-semibold">Comercial em movimento</h2><Link href="/dashboards/comercial" className="text-sm font-medium text-primary hover:underline">Abrir análise comercial</Link></div>
            <div className="grid gap-4 lg:grid-cols-2"><DonutRank title="Leads por etapa" description="Negócios em cada etapa do funil." rows={commercial.by_stage} labelHeader="Etapa" centerLabel="Negócios" /><SalesByMonth rows={commercial.by_month.map((row) => ({ mes: MONTH_LABEL(row.month), vendas: row.amount }))} /></div>
          </section>
        )}
        {financial && (
          <section aria-labelledby="grafico-financeiro" className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="grafico-financeiro" className="text-base font-semibold">Fluxo financeiro</h2><Link href="/dashboards/financeiro" className="text-sm font-medium text-primary hover:underline">Abrir análise financeira</Link></div>
            <div className="rounded-xl border bg-surface p-4">
              <FinanceRings rows={finance?.inPeriod ?? []} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <DonutCard title="Receitas por categoria" description="Recebidas e a receber no período." rows={byCategory("receita")} centerLabel="Receitas" />
              <DonutCard title="Despesas por categoria" description="Pagas e a pagar no período." rows={byCategory("despesa")} centerLabel="Despesas" />
            </div>
            <MonthlyChart rows={monthly} title="Receitas e despesas" description="Últimos 12 meses: realizado em cor cheia, previsto tracejado." />
          </section>
        )}
      </PageBody>
    </>
  );
}
