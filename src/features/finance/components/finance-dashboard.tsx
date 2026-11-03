"use client";

import { useMemo, useState } from "react";
import { DonutCard, FlowCard, ProgressRing } from "@/components/app/round-charts";
import { cn } from "cn";
import { categorySlices, monthlyEvolution, type DashboardRow } from "@/domain/finance/charge";

const MONTH = (ym: string) => new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${ym}-15T12:00:00Z`)).replace(".", "");

function Toggle<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border bg-surface p-0.5">
      {options.map(([k, text]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)} className={cn("rounded-md px-2.5 py-1 text-xs font-medium", value === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** Evolução: por mês e, quando o período cabe em um mês só, dia a dia. */
export function evolutionPoints(rows: DashboardRow[]) {
  const months = monthlyEvolution(rows);
  if (months.length > 1) return months.map((m) => ({ ...m, label: MONTH(m.mes) }));
  return monthlyEvolution(rows, "dia").map((m) => ({ ...m, label: `${m.mes.slice(8, 10)}/${m.mes.slice(5, 7)}` }));
}

const sumOf = (rows: DashboardRow[], kind: string, status: string) => rows.filter((t) => t.kind === kind && t.status === status).reduce((a, t) => a + Number(status === "pago" ? (t.paid_amount_cents ?? t.amount_cents) : t.amount_cents), 0);

/** Quanto do que estava previsto já foi recebido e pago. */
export function FinanceRings({ rows, size }: { rows: DashboardRow[]; size?: number }) {
  const received = sumOf(rows, "receita", "pago");
  const receivable = sumOf(rows, "receita", "previsto");
  const paid = sumOf(rows, "despesa", "pago");
  const payable = sumOf(rows, "despesa", "previsto");
  const total = received + paid;
  return (
    <div className="grid grid-cols-3 items-start gap-2">
      <ProgressRing label="Recebido" value={received} total={received + receivable} tone="success" size={size} />
      <ProgressRing label="Pago" value={paid} total={paid + payable} tone="danger" size={size} />
      <ProgressRing label="Entradas no total movimentado" value={received} total={total} tone="primary" size={size} />
    </div>
  );
}

export function FinanceDashboardCharts({ rows, categories, evolutionRows }: { rows: DashboardRow[]; categories: { id: string; name: string }[]; evolutionRows?: DashboardRow[] }) {
  const [kind, setKind] = useState<"receita" | "despesa">("despesa");
  const [state, setState] = useState<"pago" | "previsto">("pago");
  const names = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const slices = useMemo(() => categorySlices(rows, kind, state, names, 50), [rows, kind, state, names]);
  const evolution = useMemo(() => evolutionPoints(evolutionRows ?? rows), [evolutionRows, rows]);

  return (
    <div className="grid gap-4">
      <div className="rounded-xl border bg-surface p-4">
        <FinanceRings rows={rows} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <DonutCard
          title={`${kind === "receita" ? "Entradas" : "Saídas"} por categoria`}
          description={state === "pago" ? "Valores efetivos, já pagos ou recebidos." : "Valores pendentes, ainda em aberto."}
          rows={slices.map((s) => ({ name: s.name, value: s.value }))}
          centerLabel={kind === "receita" ? "Entradas" : "Saídas"}
          action={
            <div className="mt-1 flex flex-wrap gap-2">
              <Toggle
                label="Tipo"
                value={kind}
                onChange={setKind}
                options={[
                  ["despesa", "Saídas"],
                  ["receita", "Entradas"],
                ]}
              />
              <Toggle
                label="Situação"
                value={state}
                onChange={setState}
                options={[
                  ["pago", "Efetivo"],
                  ["previsto", "Pendente"],
                ]}
              />
            </div>
          }
        />
        <FlowCard data={evolution} />
      </div>
    </div>
  );
}

/** Retrato curto para a tela inicial: anéis, rosca de despesas e evolução. */
export function FinanceSnapshot({ rows, evolutionRows, categories }: { rows: DashboardRow[]; evolutionRows: DashboardRow[]; categories: { id: string; name: string }[] }) {
  const names = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const expenses = useMemo(() => {
    const all = [...categorySlices(rows, "despesa", "pago", names, 50), ...categorySlices(rows, "despesa", "previsto", names, 50)];
    const merged = new Map<string, number>();
    for (const s of all) merged.set(s.name, (merged.get(s.name) ?? 0) + s.value);
    return [...merged.entries()].map(([name, value]) => ({ name, value }));
  }, [rows, names]);
  const evolution = useMemo(() => evolutionPoints(evolutionRows), [evolutionRows]);
  if (!rows.length && !evolutionRows.length) return <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Sem movimento neste mês. Os gráficos aparecem com o primeiro lançamento.</p>;
  return (
    <div className="grid gap-3">
      <FinanceRings rows={rows} size={92} />
      <DonutCard title="Despesas do mês" description="Pagas e a pagar, por categoria." rows={expenses} centerLabel="Despesas" empty="Nenhuma despesa neste mês." className="border-0 bg-transparent p-0" />
      <FlowCard title="Últimos meses" description="Entradas em verde, saídas em vermelho." data={evolution} height={180} showPending={false} className="border-0 bg-transparent p-0" />
    </div>
  );
}
