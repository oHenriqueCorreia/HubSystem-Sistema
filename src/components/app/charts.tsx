"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { formatBRL } from "@/domain/shared/money";

export type Series = { key: string; label: string; color: string; forecast?: boolean };
type Datum = Record<string, string | number | null>;

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

/** Figura com título, legenda, gráfico e tabela alternativa (acessibilidade). */
export function ChartFigure({ title, description, legend, children, table }: { title: string; description?: string; legend?: ReactNode; children: ReactNode; table: ReactNode }) {
  return (
    <figure className="grid gap-3 rounded-xl border bg-surface p-4">
      <figcaption className="grid gap-1">
        <span className="text-sm font-semibold">{title}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
        {legend}
      </figcaption>
      <div aria-hidden="true">{children}</div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-primary">Ver dados em tabela</summary>
        <div className="mt-2 max-h-72 overflow-auto">{table}</div>
      </details>
    </figure>
  );
}

export function DataTable({ columns, rows }: { columns: { key: string; label: string; money?: boolean }[]; rows: Datum[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          {columns.map((c) => (
            <th key={c.key} scope="col" className={`py-1 pr-3 font-medium ${c.money ? "text-right" : ""}`}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b last:border-0">
            {columns.map((c) => (
              <td key={c.key} className={`py-1 pr-3 ${c.money ? "text-right tabular" : ""}`}>
                {c.money ? formatBRL(Number(r[c.key] ?? 0)) : String(r[c.key] ?? "")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
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

/** Barras horizontais de uma série (ranking/distribuição), com rótulo de valor ao lado. */
export function HorizontalBars({ data, labelKey, valueKey, money = false, color = "var(--chart-1)" }: { data: Datum[]; labelKey: string; valueKey: string; money?: boolean; color?: string }) {
  const max = Math.max(1, ...data.map((d) => Number(d[valueKey] ?? 0)));
  const fmt = money ? formatBRL : (v: number) => v.toLocaleString("pt-BR");
  return (
    <ul className="grid gap-2">
      {data.map((d, i) => {
        const v = Number(d[valueKey] ?? 0);
        return (
          <li key={i} className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-2 text-xs" title={`${d[labelKey]}: ${fmt(v)}`}>
            <span className="truncate text-muted-foreground">{String(d[labelKey])}</span>
            <span className="h-3 overflow-hidden rounded-r bg-muted/50">
              <span className="block h-full rounded-r" style={{ width: `${Math.max(v > 0 ? 2 : 0, (v / max) * 100)}%`, background: color }} />
            </span>
            <span className="tabular font-medium text-foreground">{fmt(v)}</span>
          </li>
        );
      })}
    </ul>
  );
}

