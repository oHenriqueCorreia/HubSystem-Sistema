import type { Metadata } from "next";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/domain/shared/money";
import { formatDateTime, todayLocal } from "@/domain/shared/dates";
import { addMonthsCivil, cashFlow } from "@/domain/finance";
import { MONTH_LABEL, monthBounds, requireFinance } from "@/features/finance/server";
import { getLookups, getSummary, listFlow, listTransactions } from "@/features/finance/queries";
import { ACCOUNT_TYPE_LABEL } from "@/features/finance/types";
import { Stat } from "@/features/finance/components/stat";
import { TxnTable } from "@/features/finance/components/txn-table";
import { MonthlyChart } from "@/features/finance/components/monthly-chart";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Financeiro" };

export default async function FinanceOverview({ params }: PageProps<"/financeiro/[contexto]">) {
  const { contexto } = await params;
  const { scope, perms } = await requireFinance(contexto);
  const today = todayLocal();
  const month = monthBounds(today);
  const sixAgo = monthBounds(addMonthsCivil(today, -5)).from;
  const horizon = new Date(Date.parse(`${today}T12:00:00Z`) + 15 * 86_400_000).toISOString().slice(0, 10);

  const [summary, lookups, overdue, upcoming, flow] = await Promise.all([
    getSummary(scope, month.from, month.to),
    getLookups(scope),
    listTransactions(scope, { situacao: "vencidos" }, today),
    listTransactions(scope, { situacao: "abertos", de: today, ate: horizon }, today),
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
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Saldo atual (contas)" cents={summary.balance} tone="negative" />
        <Stat label="Recebido no mês" cents={summary.income_paid} hint={`Competência: ${formatBRL(summary.income_competence)}`} />
        <Stat label="Pago no mês" cents={summary.expense_paid} hint={`Competência: ${formatBRL(summary.expense_competence)}`} />
        <Stat label="Resultado do mês" cents={result} tone="negative" hint="Recebido − pago" />
        <Stat label="A receber" cents={summary.receivable_open} />
        <Stat label="A pagar" cents={summary.payable_open} />
        <Stat label="Recebimentos vencidos" cents={summary.receivable_overdue} alert />
        <Stat label="Pagamentos vencidos" cents={summary.payable_overdue} alert />
      </dl>

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
                Próximos 15 dias ({upcoming.total})
              </h2>
              <Link href={`/financeiro/${scope}/lancamentos?situacao=abertos`} className="text-xs text-primary hover:underline">
                Ver contas a vencer
              </Link>
            </div>
            {upcoming.total === 0 ? <p className="text-sm text-muted-foreground">Nada a vencer nos próximos 15 dias.</p> : <TxnTable scope={scope} rows={upcoming.rows.slice(0, 15)} lookups={lookups} perms={perms} />}
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
