import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Wallet } from "lucide-react";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/domain/shared/money";
import { formatDate, formatDateTime, todayLocal } from "@/domain/shared/dates";
import { addMonthsCivil, cashFlow } from "@/domain/finance";
import { MONTH_LABEL, monthBounds, requireFinance } from "@/features/finance/server";
import { getLookups, getOpenInPeriod, getSummary, listFlow, listTransactions } from "@/features/finance/queries";
import { FINANCE_PRESETS, resolvePeriod } from "@/features/dashboards/period";
import { DashboardFilters } from "@/features/dashboards/components/dashboard-filters";
import { ACCOUNT_TYPE_LABEL } from "@/features/finance/types";
import { Stat } from "@/features/finance/components/stat";
import { TxnTable } from "@/features/finance/components/txn-table";
import { MonthlyChart } from "@/features/finance/components/monthly-chart";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Financeiro" };

export default async function FinanceOverview({ params, searchParams }: PageProps<"/financeiro/[contexto]">) {
  const { contexto } = await params;
  const { scope, perms } = await requireFinance(contexto);
  const today = todayLocal();
  const period = resolvePeriod(await searchParams);
  const month = monthBounds(today);
  const sixAgo = monthBounds(addMonthsCivil(today, -5)).from;
  // Lista "em aberto": do maior entre hoje e o início do período até o fim do período.
  const openFrom = period.from > today ? period.from : today;

  const [summary, open, lookups, overdue, upcoming, flow] = await Promise.all([
    getSummary(scope, period.from, period.to),
    getOpenInPeriod(scope, period.from, period.to, today),
    getLookups(scope),
    listTransactions(scope, { situacao: "vencidos" }, today),
    openFrom <= period.to ? listTransactions(scope, { situacao: "abertos", de: openFrom, ate: period.to }, today) : Promise.resolve({ rows: [], total: 0 }),
    listFlow(scope, sixAgo, month.to),
  ]);

  const monthly = cashFlow(flow, "mes").map((r) => ({
    mes: MONTH_LABEL(r.period),
    receitas: r.income,
    despesas: r.expense,
    receitasPrev: r.incomeForecast,
    despesasPrev: r.expenseForecast,
  }));
  const result = summary.income_paid - summary.expense_paid;

  let reads: { actor_name: string | null; read_at: string }[] = [];
  if (scope === "pessoal") {
    const supabase = await createClient();
    const { data } = await supabase.rpc("my_personal_finance_reads");
    reads = (data ?? []) as typeof reads;
  }

  const empty = summary.accounts.length > 0 && flow.length === 0 && overdue.total === 0 && upcoming.total === 0;

  return (
    <div className="grid gap-8">
      <div className="grid gap-2">
        <Suspense>
          <DashboardFilters preset={period.preset} from={period.from} to={period.to} presets={FINANCE_PRESETS} storageKey="hub:financeiro-periodo" />
        </Suspense>
        <p className="text-sm text-muted-foreground">
          {period.from === period.to ? formatDate(period.from) : `${formatDate(period.from)} a ${formatDate(period.to)}`}. Os totais somam o que vence no período, pago ou não.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Receitas do período" cents={summary.income_competence} hint={`Recebido ${formatBRL(summary.income_paid)}, falta ${formatBRL(open.receivable)}`} />
        <Stat label="Despesas do período" cents={summary.expense_competence} hint={`Pago ${formatBRL(summary.expense_paid)}, falta ${formatBRL(open.payable)}`} />
        <Stat label="Resultado previsto" cents={summary.income_competence - summary.expense_competence} tone="negative" hint="Receitas − despesas do período" />
        <Stat label="Saldo atual (contas)" cents={summary.balance} tone="negative" />
        <Stat label="A receber no período" cents={open.receivable} hint={`${open.receivableCount} lançamento(s) em aberto`} />
        <Stat label="A pagar no período" cents={open.payable} hint={`${open.payableCount} lançamento(s) em aberto`} />
        <Stat label="Recebimentos vencidos" cents={summary.receivable_overdue} alert />
        <Stat label="Pagamentos vencidos" cents={summary.payable_overdue} alert />
      </dl>
      <p className="-mt-5 text-xs text-muted-foreground">Resultado realizado (recebido − pago no período): {formatBRL(result)}.</p>

      {empty ? (
        <EmptyState
          icon={Wallet}
          title="Nenhum lançamento ainda"
          description="Lance receitas e despesas, use parcelas e recorrências, ou gere as cobranças de um contrato. O fluxo de caixa é montado automaticamente."
        />
      ) : (
        <>
          {overdue.total > 0 && (
            <section aria-labelledby="vencidos" className="grid gap-2">
              <div className="flex items-center justify-between">
                <h2 id="vencidos" className="text-sm font-semibold text-danger">
                  Vencidos ({overdue.total})
                </h2>
                <Link href={`/financeiro/${scope}/lancamentos?situacao=vencidos`} className="text-xs text-primary hover:underline">
                  Ver todos
                </Link>
              </div>
              <TxnTable scope={scope} rows={overdue.rows.slice(0, 10)} lookups={lookups} perms={perms} />
            </section>
          )}
          <section aria-labelledby="proximos" className="grid gap-2">
            <div className="flex items-center justify-between">
              <h2 id="proximos" className="text-sm font-semibold">
                Em aberto no período ({upcoming.total})
              </h2>
              <Link href={`/financeiro/${scope}/lancamentos?situacao=abertos&de=${openFrom}&ate=${period.to}`} className="text-xs text-primary hover:underline">
                Ver todos
              </Link>
            </div>
            {upcoming.total === 0 ? (
              <p className="text-sm text-muted-foreground">Nada em aberto vencendo neste período.</p>
            ) : (
              <TxnTable scope={scope} rows={upcoming.rows.slice(0, 20)} lookups={lookups} perms={perms} />
            )}
          </section>
          {monthly.length > 0 && <MonthlyChart rows={monthly} description="Últimos 6 meses. Previstos aparecem com contorno tracejado." />}
        </>
      )}

      <section aria-labelledby="contas" className="grid gap-2">
        <h2 id="contas" className="text-sm font-semibold">
          Saldo por conta
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {summary.accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border bg-surface px-3 py-2">
              <span className="grid">
                <span className="text-sm font-medium">{a.name}</span>
                <span className="text-xs text-muted-foreground">{ACCOUNT_TYPE_LABEL[a.type] ?? a.type}</span>
              </span>
              <span className={`tabular font-semibold ${a.balance < 0 ? "text-danger" : ""}`}>{formatBRL(a.balance)}</span>
            </li>
          ))}
        </ul>
        {summary.accounts.length === 0 && (
          <Button asChild variant="outline" className="justify-self-start">
            <Link href={`/financeiro/${scope}/cadastros`}>Cadastrar conta</Link>
          </Button>
        )}
      </section>

      {scope === "pessoal" && (
        <section aria-labelledby="consultas" className="grid gap-1 text-sm">
          <h2 id="consultas" className="text-sm font-semibold">
            Consultas do administrador
          </h2>
          {reads.length === 0 ? (
            <p className="text-muted-foreground">Ninguém consultou seu financeiro pessoal.</p>
          ) : (
            <ul className="text-muted-foreground">
              {reads.map((r, i) => (
                <li key={i}>
                  {r.actor_name ?? "Administrador"} consultou em {formatDateTime(r.read_at)}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
