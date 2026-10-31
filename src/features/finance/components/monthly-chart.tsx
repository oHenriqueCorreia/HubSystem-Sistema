"use client";

import { ChartFigure, DataTable, GroupedBars } from "@/components/app/charts";

/** Receitas × despesas por mês (realizado e previsto), uma escala. */
export function MonthlyChart({ rows, title = "Receitas e despesas por mês", description }: { rows: { mes: string; receitas: number; despesas: number; receitasPrev: number; despesasPrev: number }[]; title?: string; description?: string }) {
  const series = [
    { key: "receitas", label: "Receitas realizadas", color: "var(--chart-1)" },
    { key: "receitasPrev", label: "Receitas previstas", color: "var(--chart-1)", forecast: true },
    { key: "despesas", label: "Despesas realizadas", color: "var(--chart-2)" },
    { key: "despesasPrev", label: "Despesas previstas", color: "var(--chart-2)", forecast: true },
  ];
  return (
    <ChartFigure
      title={title}
      description={description}
      table={
        <DataTable
          columns={[
            { key: "mes", label: "Mês" },
            { key: "receitas", label: "Receitas realizadas", money: true },
            { key: "receitasPrev", label: "Receitas previstas", money: true },
            { key: "despesas", label: "Despesas realizadas", money: true },
            { key: "despesasPrev", label: "Despesas previstas", money: true },
          ]}
          rows={rows}
        />
      }
    >
      <GroupedBars data={rows} xKey="mes" series={series} />
    </ChartFigure>
  );
}
