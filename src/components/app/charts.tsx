"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { formatBRL } from "@/domain/shared/money";

export type Series = { key: string; label: string; color: string; forecast?: boolean };
export type Datum = Record<string, string | number | null>;

const Loading = () => <div className="h-56 animate-pulse rounded-lg bg-muted/40" aria-hidden="true" />;

// Recharts pesa cerca de 380 KB: só baixa na tela que tem gráfico, depois do conteúdo.
export const GroupedBars = dynamic(() => import("./charts-plot").then((m) => m.GroupedBars), { ssr: false, loading: Loading });
export const SingleLine = dynamic(() => import("./charts-plot").then((m) => m.SingleLine), { ssr: false, loading: Loading });

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

