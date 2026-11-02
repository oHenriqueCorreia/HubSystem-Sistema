import type { Metadata } from "next";
import { Repeat } from "lucide-react";
import { EmptyState } from "@/components/app/states";
import { formatBRL } from "@/domain/shared/money";
import { todayLocal } from "@/domain/shared/dates";
import { monthBounds, requireFinance } from "@/features/finance/server";
import { fixedVsVariable, getLookups, listRecurrences } from "@/features/finance/queries";
import { RecurrenceTable } from "@/features/finance/components/recurrence-table";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

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

  // Empresa: nomes dos clientes das receitas de contrato e receita recorrente por cliente.
  const clientIds = [...new Set(rows.map((r) => r.client_id).filter((x): x is string => Boolean(x)))];
  const clients = new Map<string, string>();
  if (scope === "empresa" && clientIds.length) {
    const supabase = await createClient();
    const { data } = await supabase.from("clients").select("id, legal_name, lead:leads(name)").in("id", clientIds);
    for (const c of (data ?? []) as { id: string; legal_name: string | null; lead: { name: string } | { name: string }[] | null }[]) {
      const lead = Array.isArray(c.lead) ? c.lead[0] : c.lead;
      clients.set(c.id, lead?.name ?? c.legal_name ?? "Cliente");
    }
  }
  const byClient = [...clientIds]
    .map((id) => ({ id, name: clients.get(id) ?? "Cliente", monthly: active.filter((r) => r.kind === "receita" && r.client_id === id).reduce((a, r) => a + r.monthly_cents, 0), contracts: active.filter((r) => r.client_id === id && r.contract_id).length }))
    .filter((c) => c.monthly > 0)
    .sort((a, b) => b.monthly - a.monthly);

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
        <RecurrenceTable rows={rows} categories={categories} clients={clients} canEdit={perms.update} />
      )}
      {byClient.length > 0 && (
        <section aria-labelledby="por-cliente" className="grid gap-2">
          <h2 id="por-cliente" className="text-sm font-semibold">
            Receita recorrente por cliente
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {byClient.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg border bg-surface px-3 py-2">
                <span className="grid min-w-0">
                  <Link href={`/clientes/${c.id}`} className="truncate text-sm font-medium hover:underline">
                    {c.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">{c.contracts} {c.contracts === 1 ? "contrato ativo" : "contratos ativos"}</span>
                </span>
                <span className="tabular shrink-0 font-semibold">{formatBRL(c.monthly)}/mês</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
