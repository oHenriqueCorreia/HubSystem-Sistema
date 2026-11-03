"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { formatBRL } from "@/domain/shared/money";
import type { Datum, Series } from "./charts";

// Parte pesada dos gráficos (Recharts): carregada sob demanda por charts.tsx.

const compactBRL = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 }).format(cents / 100);

function TooltipBox({ active, payload, label, format, series }: TooltipContentProps<number, string> & { format: (v: number) => string; series: Series[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      <ul className="grid gap-0.5">
        {payload.map((p) => {
          const s = series.find((x) => x.key === p.dataKey);
          return (
            <li key={String(p.dataKey)} className="flex items-center gap-2 text-muted-foreground">
              <span className="size-2 rounded-sm" style={{ background: s?.color }} aria-hidden="true" />
              <span>{s?.label ?? p.name}</span>
              <span className="ml-auto tabular font-medium text-foreground">{format(Number(p.value ?? 0))}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-sm"
            style={s.forecast ? { background: "transparent", border: `1.5px dashed ${s.color}` } : { background: s.color }}
            aria-hidden="true"
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Barras verticais agrupadas (ex.: receitas × despesas por mês). Uma escala só. */
export function GroupedBars({ data, xKey, series, money = true, height = 260 }: { data: Datum[]; xKey: string; series: Series[]; money?: boolean; height?: number }) {
  const fmt = money ? formatBRL : (v: number) => v.toLocaleString("pt-BR");
  return (
    <div className="grid gap-2">
      <Legend series={series} />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} barGap={2} barCategoryGap="24%" margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: "var(--chart-axis)" }} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={money ? 64 : 36}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={(v: number) => (money ? compactBRL(v) : v.toLocaleString("pt-BR"))}
          />
          <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={(p) => <TooltipBox {...(p as TooltipContentProps<number, string>)} format={fmt} series={series} />} />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color}
              fillOpacity={s.forecast ? 0.35 : 1}
              stroke={s.forecast ? s.color : undefined}
              strokeDasharray={s.forecast ? "4 3" : undefined}
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Linha única (ex.: saldo acumulado). */
export function SingleLine({ data, xKey, yKey, label, color = "var(--chart-1)", height = 220 }: { data: Datum[]; xKey: string; yKey: string; label: string; color?: string; height?: number }) {
  const series = [{ key: yKey, label, color }];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: "var(--chart-axis)" }} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
        <YAxis tickLine={false} axisLine={false} width={64} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickFormatter={(v: number) => compactBRL(v)} />
        <Tooltip cursor={{ stroke: "var(--chart-axis)" }} content={(p) => <TooltipBox {...(p as TooltipContentProps<number, string>)} format={formatBRL} series={series} />} />
        <Line type="monotone" dataKey={yKey} name={label} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
