"use client";

import { ChartFigure, DataTable, GroupedBars, HorizontalBars } from "@/components/app/charts";

type Named = { name: string; count?: number; amount?: number };

export function StageFunnel({ stages }: { stages: { name: string; count: number; amount: number }[] }) {
  return (
    <ChartFigure
      title="Leads por etapa"
      description="Quantidade atual de negócios em cada etapa do funil."
      table={<DataTable columns={[{ key: "name", label: "Etapa" }, { key: "count", label: "Negócios" }, { key: "amount", label: "Valor", money: true }]} rows={stages} />}
    >
      <HorizontalBars data={stages} labelKey="name" valueKey="count" />
    </ChartFigure>
  );
}

export function RankBars({ title, description, rows, money, valueKey = money ? "amount" : "count", labelHeader = "Nome" }: { title: string; description?: string; rows: Named[]; money?: boolean; valueKey?: string; labelHeader?: string }) {
  return (
    <ChartFigure
      title={title}
      description={description}
      table={<DataTable columns={[{ key: "name", label: labelHeader }, { key: valueKey, label: money ? "Valor" : "Quantidade", money }]} rows={rows} />}
    >
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">Sem dados no período.</p> : <HorizontalBars data={rows} labelKey="name" valueKey={valueKey} money={money} />}
    </ChartFigure>
  );
}

export function SalesByMonth({ rows }: { rows: { mes: string; vendas: number }[] }) {
  return (
    <ChartFigure
      title="Vendas por mês"
      description="Valor dos contratos iniciados (últimos 12 meses)."
      table={<DataTable columns={[{ key: "mes", label: "Mês" }, { key: "vendas", label: "Vendas", money: true }]} rows={rows} />}
    >
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum contrato no período.</p> : <GroupedBars data={rows} xKey="mes" series={[{ key: "vendas", label: "Vendas", color: "var(--chart-1)" }]} />}
    </ChartFigure>
  );
}
