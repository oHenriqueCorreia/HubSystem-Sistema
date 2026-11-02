import type { Metadata } from "next";
import { Repeat } from "lucide-react";
import { EmptyState } from "@/components/app/states";
import { formatBRL } from "@/domain/shared/money";
import { todayLocal } from "@/domain/shared/dates";
import { monthBounds, requireFinance } from "@/features/finance/server";
import { fixedVsVariable, getLookups, listRecurrences } from "@/features/finance/queries";
import { RecurrenceTable } from "@/features/finance/components/recurrence-table";

export const metadata: Metadata = { title: "Fixos e recorrentes" };

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid gap-0.5 rounded-xl border bg-surface p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="tabular text-xl font-semibold">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

export default async function RecorrentesPage({ params }: { params: Promise<{ contexto: string }> }) {
  const { contexto } = await params;
  const { scope, perms } = await requireFinance(contexto);
  const today = todayLocal();
  const { from, to } = monthBounds(today);
  const [rows, split, lookups] = await Promise.all([listRecurrences(scope, today), fixedVsVariable(scope, from, to), getLookups(scope)]);
  const active = rows.filter((r) => r.state === "ativa");
  const fixedOut = active.filter((r) => r.kind === "despesa").reduce((a, r) => a + r.monthly_cents, 0);
  const fixedIn = active.filter((r) => r.kind === "receita").reduce((a, r) => a + r.monthly_cents, 0);
  const categories = new Map(lookups.categories.map((c) => [c.id, c.name]));

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          Despesas que você paga sempre e receitas que recebe sempre. Escolha o dia do mês ou o dia útil (ex.: 5º dia útil) e as datas aparecem em Lançamentos, nos painéis, no Início e nas notificações do dia. Aqui você
          também pausa ou encerra cada série sem alterar o que já aconteceu.
        </p>
      </div>
      <section aria-label="Resumo do mês" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Despesas fixas por mês" value={formatBRL(fixedOut)} hint={`${active.filter((r) => r.kind === "despesa").length} série(s) ativa(s)`} />
        <Tile label="Receitas fixas por mês" value={formatBRL(fixedIn)} hint={`${active.filter((r) => r.kind === "receita").length} série(s) ativa(s)`} />
        <Tile label="Despesas variáveis no mês" value={formatBRL(split.despesaVariavel)} hint={split.parcelas ? `Inclui ${formatBRL(split.parcelas)} em parcelas` : undefined} />
        <Tile label="Saldo previsto do mês" value={formatBRL(split.receitaFixa + split.receitaVariavel - split.despesaFixa - split.despesaVariavel)} hint="Receitas menos despesas (competência)" />
      </section>
      {rows.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title="Nenhum lançamento recorrente"
          description="Clique em “Nova recorrência” (no topo) para cadastrar o que você paga sempre (aluguel, mensalidades, assinaturas) ou recebe sempre (salário, contratos). As datas aparecem aqui, em Lançamentos e no Início."
        />
      ) : (
        <RecurrenceTable rows={rows} categories={categories} canEdit={perms.update} />
      )}
    </div>
  );
}
