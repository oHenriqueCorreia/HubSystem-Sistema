"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { ChartFigure, DataTable } from "@/components/app/charts";
import { cn } from "cn";
import { categorySlices, monthlyEvolution, type DashboardRow } from "@/domain/finance/charge";
import { formatBRL } from "@/domain/shared/money";

const Loading = () => <div className="h-64 animate-pulse rounded-lg bg-muted/40" aria-hidden="true" />;
const CategoryPie = dynamic(() => import("./finance-dashboard-plot").then((m) => m.CategoryPie), { ssr: false, loading: Loading });
const EvolutionLines = dynamic(() => import("./finance-dashboard-plot").then((m) => m.EvolutionLines), { ssr: false, loading: Loading });

const SLICE_COLORS = ["var(--slice-1)", "var(--slice-2)", "var(--slice-3)", "var(--slice-4)", "var(--slice-5)", "var(--slice-6)", "var(--slice-7)", "var(--slice-8)"];
const MONTH = (ym: string) => new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${ym}-15T12:00:00Z`)).replace(".", "");
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

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

export function FinanceDashboardCharts({ rows, categories }: { rows: DashboardRow[]; categories: { id: string; name: string }[] }) {
  const [kind, setKind] = useState<"receita" | "despesa">("despesa");
  const [state, setState] = useState<"pago" | "previsto">("pago");
  const [active, setActive] = useState<number | null>(null);
  const names = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const slices = useMemo(() => categorySlices(rows, kind, state, names), [rows, kind, state, names]);
  const total = slices.reduce((a, s) => a + s.value, 0);
  // Um mês só viraria um ponto: nesse caso a evolução aparece dia a dia.
  const evolution = useMemo(() => {
    const months = monthlyEvolution(rows);
    if (months.length > 1) return months.map((m) => ({ ...m, label: MONTH(m.mes) }));
    return monthlyEvolution(rows, "dia").map((m) => ({ ...m, label: m.mes.slice(8, 10) + "/" + m.mes.slice(5, 7) }));
  }, [rows]);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartFigure
        title={`${kind === "receita" ? "Entradas" : "Saídas"} por categoria`}
        description={state === "pago" ? "Valores efetivos, já pagos ou recebidos." : "Valores pendentes, ainda em aberto."}
        legend={
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
        table={<DataTable columns={[{ key: "name", label: "Categoria" }, { key: "value", label: "Valor", money: true }, { key: "percentual", label: "Percentual" }]} rows={slices.map((s) => ({ name: s.name, value: s.value, percentual: pct(s.percent) }))} />}
      >
        {slices.length === 0 ? (
          <p className="grid h-64 place-items-center text-sm text-muted-foreground">Nada neste período.</p>
        ) : (
          <div className="grid items-center gap-3 sm:grid-cols-2">
            <CategoryPie slices={slices} active={active} onActive={setActive} />
            {/* Categoria, valor e percentual sempre escritos: a leitura não depende da cor. */}
            <ul className="grid gap-1 text-xs">
              {slices.map((s, i) => (
                <li key={s.id} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} className={cn("grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-2 rounded px-1 py-0.5", active === i && "bg-accent")}>
                  <span className="size-2.5 self-center rounded-sm" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                  <span className="break-words">{s.name}</span>
                  <span className="tabular text-right">
                    {formatBRL(s.value)} <span className="text-muted-foreground">{pct(s.percent)}</span>
                  </span>
                </li>
              ))}
              <li className="mt-1 flex justify-between border-t px-1 pt-1 font-medium">
                <span>Total</span>
                <span className="tabular">{formatBRL(total)}</span>
              </li>
            </ul>
          </div>
        )}
      </ChartFigure>

      <ChartFigure
        title="Evolução no tempo"
        description="Verde para entradas, vermelho para saídas. Linha tracejada é o que ainda está pendente."
        table={
          <DataTable
            columns={[
              { key: "label", label: "Período" },
              { key: "entradas", label: "Entradas recebidas", money: true },
              { key: "saidas", label: "Saídas pagas", money: true },
              { key: "entradasPendentes", label: "Entradas a receber", money: true },
              { key: "saidasPendentes", label: "Saídas a pagar", money: true },
            ]}
            rows={evolution}
          />
        }
      >
        {evolution.length === 0 ? <p className="grid h-64 place-items-center text-sm text-muted-foreground">Nada neste período.</p> : <EvolutionLines data={evolution} />}
      </ChartFigure>
    </div>
  );
}
