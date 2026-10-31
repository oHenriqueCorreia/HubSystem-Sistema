"use client";

import { ChartFigure, DataTable, GroupedBars, SingleLine } from "@/components/app/charts";

type Row = { periodo: string; receitas: number; receitasPrev: number; despesas: number; despesasPrev: number; liquido: number; saldo: number };

/** Entradas × saídas por período e, num gráfico separado (escala própria), o saldo acumulado. */
export function CashFlowCharts({ rows }: { rows: Row[] }) {
  const table = (
    <DataTable
      columns={[
        { key: "periodo", label: "Período" },
        { key: "receitas", label: "Entradas realizadas", money: true },
        { key: "receitasPrev", label: "Entradas previstas", money: true },
        { key: "despesas", label: "Saídas realizadas", money: true },
        { key: "despesasPrev", label: "Saídas previstas", money: true },
        { key: "liquido", label: "Resultado", money: true },
        { key: "saldo", label: "Saldo acumulado", money: true },
      ]}
      rows={rows}
    />
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartFigure title="Entradas e saídas" description="Realizado em cor cheia; previsto com contorno tracejado." table={table}>
        <GroupedBars
          data={rows}
          xKey="periodo"
          series={[
            { key: "receitas", label: "Entradas realizadas", color: "var(--chart-1)" },
            { key: "receitasPrev", label: "Entradas previstas", color: "var(--chart-1)", forecast: true },
            { key: "despesas", label: "Saídas realizadas", color: "var(--chart-2)" },
            { key: "despesasPrev", label: "Saídas previstas", color: "var(--chart-2)", forecast: true },
          ]}
        />
      </ChartFigure>
      <ChartFigure title="Saldo acumulado" description="Saldo das contas ao fim de cada período, incluindo o previsto." table={table}>
        <SingleLine data={rows} xKey="periodo" yKey="saldo" label="Saldo acumulado" />
      </ChartFigure>
    </div>
  );
}
