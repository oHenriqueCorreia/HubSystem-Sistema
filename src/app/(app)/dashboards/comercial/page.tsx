import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlarmClock } from "lucide-react";
import { requirePermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { formatBRL } from "@/domain/shared/money";
import { formatDate } from "@/domain/shared/dates";
import { getCrmLookups } from "@/features/crm/queries";
import { resolvePeriod } from "@/features/dashboards/period";
import { DashboardFilters } from "@/features/dashboards/components/dashboard-filters";
import { DashboardTabs } from "@/features/dashboards/components/dashboard-tabs";
import { Kpi } from "@/features/dashboards/components/kpi";
import { DonutRank, RankBars, SalesByMonth, StageFunnel } from "@/features/dashboards/components/commercial-charts";
import { MONTH_LABEL } from "@/features/finance/server";

export const metadata: Metadata = { title: "Dashboard comercial" };

type Data = {
  /** Sem contracts.values o banco não soma valores de contrato. */
  values_hidden: boolean;
  total_leads: number;
  new_leads: number;
  by_stage: { id: string; name: string; kind: string; count: number; amount: number }[];
  by_owner: { owner_id: string | null; name: string; count: number; won: number }[];
  meetings: number;
  meetings_stage: number;
  proposals: number;
  won: number;
  lost: number;
  lost_reasons: { name: string; count: number }[];
  revenue: number;
  contracts: number;
  mrr: number;
  by_month: { month: string; amount: number; count: number }[];
  by_service: { name: string; amount: number; count: number }[];
  pipeline_open_amount: number;
  forecast: { month: string; amount: number }[];
  overdue_tasks: number;
  overdue_contacts: number;
};

export default async function ComercialPage({ searchParams }: PageProps<"/dashboards/comercial">) {
  const user = await requirePermission("dashboards.commercial");
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const lookups = await getCrmLookups();
  const seeAll = user.permissions["dashboards.commercial"] !== "own";
  const owner = seeAll && typeof sp.responsavel === "string" && sp.responsavel ? sp.responsavel : seeAll ? null : user.id;
  const pipeline = typeof sp.funil === "string" && sp.funil ? sp.funil : null;

  const supabase = await createClient();
  const [cur, prev] = await Promise.all([
    supabase.rpc("commercial_dashboard", { p_from: period.from, p_to: period.to, p_owner: owner, p_pipeline: pipeline }),
    supabase.rpc("commercial_dashboard", { p_from: period.prevFrom, p_to: period.prevTo, p_owner: owner, p_pipeline: pipeline }),
  ]);
  if (cur.error) throw cur.error;
  const d = cur.data as Data;
  const p = (prev.data ?? d) as Data;

  const conv = d.won + d.lost > 0 ? Math.round((d.won / (d.won + d.lost)) * 100) : 0;
  const convPrev = p.won + p.lost > 0 ? Math.round((p.won / (p.won + p.lost)) * 100) : 0;
  const ticket = d.contracts ? Math.round(d.revenue / d.contracts) : 0;
  const ticketPrev = p.contracts ? Math.round(p.revenue / p.contracts) : 0;
  const forecastTotal = d.forecast.reduce((s, f) => s + f.amount, 0) + d.mrr * 3;
  const values = !d.values_hidden;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Análise" }, { label: "Comercial" }]}
        title="Dashboard comercial"
        description={`${formatDate(period.from)} a ${formatDate(period.to)}${!seeAll ? " · seus números" : ""}. Comparação com ${formatDate(period.prevFrom)}–${formatDate(period.prevTo)}.`}
      />
      <PageBody className="grid gap-6">
        <DashboardTabs commercial financial={Boolean(user.permissions["dashboards.financial"])} />
        <Suspense>
          <DashboardFilters
            preset={period.preset}
            from={period.from}
            to={period.to}
            extra={[
              ...(lookups.pipelines.length > 1 ? [{ name: "funil", label: "Funil", value: pipeline ?? "", options: [["", "Principal"], ...lookups.pipelines.map((x) => [x.id, x.name] as [string, string])] as [string, string][] }] : []),
              ...(seeAll ? [{ name: "responsavel", label: "Responsável", value: owner ?? "", options: [["", "Todos"], ...lookups.owners.map((o) => [o.id, o.full_name || o.email] as [string, string])] as [string, string][] }] : []),
            ]}
          />
        </Suspense>

        {(d.overdue_tasks > 0 || d.overdue_contacts > 0) && (
          <p className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger" role="status">
            <AlarmClock className="size-4" aria-hidden="true" />
            Atividades atrasadas: {d.overdue_tasks} tarefa(s) e {d.overdue_contacts} contato(s) agendado(s).
            <Link href="/tarefas?periodo=atrasadas" className="underline">
              Ver tarefas
            </Link>
            <Link href="/crm/leads?contato=atrasado" className="underline">
              Ver leads
            </Link>
          </p>
        )}

        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Total de leads" value={d.total_leads} hint={`${d.new_leads} novo(s) no período`} />
          <Kpi label="Reuniões marcadas" value={Math.max(d.meetings, d.meetings_stage)} previous={Math.max(p.meetings, p.meetings_stage)} />
          <Kpi label="Propostas enviadas" value={d.proposals} previous={p.proposals} />
          <Kpi label="Contratos fechados" value={d.won} previous={p.won} />
          <Kpi label="Negócios perdidos" value={d.lost} previous={p.lost} invert />
          <Kpi label="Taxa de conversão" value={conv} previous={convPrev} suffix="%" hint="Ganhos ÷ (ganhos + perdidos)" />
          {values && <Kpi label="Receita gerada" value={d.revenue} previous={p.revenue} money hint={`${d.contracts} contrato(s)`} />}
          {values && <Kpi label="Ticket médio" value={ticket} previous={ticketPrev} money />}
        </dl>

        <dl className="grid gap-3 sm:grid-cols-3">
          {values && <Kpi label="Recorrente ativo (MRR)" value={d.mrr} money />}
          <Kpi label="Em negociação no funil" value={d.pipeline_open_amount} money hint="Soma dos valores dos negócios abertos" />
          {values && <Kpi label="Previsão de receita (90 dias)" value={forecastTotal} money hint="Negócios com previsão de fechamento + 3 meses de recorrente" />}
        </dl>

        <div className="grid gap-4 lg:grid-cols-2">
          <StageFunnel stages={d.by_stage} />
          <DonutRank title="Leads por responsável" centerLabel="Leads" rows={d.by_owner.map((o) => ({ name: o.name, count: o.count }))} labelHeader="Responsável" />
          {values && <SalesByMonth rows={d.by_month.map((m) => ({ mes: MONTH_LABEL(m.month), vendas: m.amount }))} />}
          {values && <DonutRank title="Vendas por serviço" centerLabel="Vendas" description="Contratos iniciados no período." rows={d.by_service} money labelHeader="Serviço" />}
          <DonutRank title="Motivos de perda" centerLabel="Perdas" rows={d.lost_reasons} labelHeader="Motivo" />
          {d.forecast.length > 0 && (
            <RankBars title="Previsão de fechamento" description="Valor dos negócios abertos por mês previsto." rows={d.forecast.map((f) => ({ name: MONTH_LABEL(f.month), amount: f.amount }))} money labelHeader="Mês" />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {values
            ? `Valores em reais. Receita gerada considera contratos com início no período (${formatBRL(d.revenue)}).`
            : "Valores de contratos ficam ocultos para o seu papel. Peça ao administrador a permissão “Ver e definir valores de contratos”."}
        </p>
      </PageBody>
    </>
  );
}
