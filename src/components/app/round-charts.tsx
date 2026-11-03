"use client";

import { FitNumber } from "./fit-number";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "cn";
import { formatBRL } from "@/domain/shared/money";
import { DataTable } from "./charts";
import { useCountUp, useMotionOk } from "./use-motion";

const Loading = ({ height }: { height: number }) => <div className="mx-auto aspect-square animate-pulse rounded-full bg-muted/40" style={{ height }} aria-hidden="true" />;
const DonutPlot = dynamic(() => import("./round-charts-plot").then((m) => m.DonutPlot), { ssr: false, loading: () => <Loading height={220} /> });
const FlowPlot = dynamic(() => import("./round-charts-plot").then((m) => m.FlowPlot), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-lg bg-muted/40" aria-hidden="true" /> });

const COLORS = ["var(--slice-1)", "var(--slice-2)", "var(--slice-3)", "var(--slice-4)", "var(--slice-5)", "var(--slice-6)", "var(--slice-7)", "var(--slice-8)"];
const MAX_SLICES = 7;
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export type DonutRow = { name: string; value: number };

/** Maiores fatias e o restante em "Outras": além disso a rosca fica ilegível. */
export function toSlices(rows: DonutRow[]) {
  const positive = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const sum = positive.reduce((a, r) => a + r.value, 0);
  const top = positive.slice(0, MAX_SLICES);
  const rest = positive.slice(MAX_SLICES).reduce((a, r) => a + r.value, 0);
  return { sum, slices: [...top, ...(rest ? [{ name: "Outras", value: rest }] : [])].map((r) => ({ ...r, percent: sum ? (r.value / sum) * 100 : 0 })) };
}

/** Rosca animada com total no centro. Categoria, valor e percentual sempre escritos: a leitura não depende da cor. */
export function Donut({ rows, money = true, centerLabel = "Total", empty = "Nada neste período.", height = 220, compact = false }: { rows: DonutRow[]; money?: boolean; centerLabel?: string; empty?: string; height?: number; compact?: boolean }) {
  const { slices, sum } = useMemo(() => toSlices(rows), [rows]);
  const [active, setActive] = useState<number | null>(null);
  const counted = useCountUp(sum);
  const fmt = (v: number) => (money ? formatBRL(Math.round(v)) : Math.round(v).toLocaleString("pt-BR"));
  const current = active !== null ? slices[active] : null;

  if (!slices.length) return <p className="grid place-items-center text-sm text-muted-foreground" style={{ minHeight: height }}>{empty}</p>;
  return (
    <div className={cn("grid items-center gap-3", !compact && "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
      <div className="relative min-w-0">
        <DonutPlot slices={slices} active={active} onActive={setActive} height={height} />
        <div className="@container pointer-events-none absolute inset-y-0 left-1/2 grid w-[56%] max-w-44 -translate-x-1/2 place-content-center text-center" aria-hidden="true">
          <span className="truncate text-xs text-muted-foreground">{current ? current.name : centerLabel}</span>
          <FitNumber text={current ? fmt(current.value) : fmt(counted)} maxRem={1.125} className="leading-tight" />
          {current && <span className="text-xs text-muted-foreground tabular">{pct(current.percent)}</span>}
        </div>
      </div>
      <ul className="grid min-w-0 gap-0.5 text-xs">
        {slices.map((s, i) => (
          <li
            key={s.name}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            className={cn("grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-2 rounded px-1.5 py-1 transition-colors", active === i && "bg-accent")}
          >
            <span className="size-2.5 self-center rounded-sm" style={{ background: COLORS[i % COLORS.length] }} aria-hidden="true" />
            <span className="break-words">{s.name}</span>
            <span className="text-right whitespace-nowrap tabular">
              {fmt(s.value)} <span className="text-muted-foreground">{pct(s.percent)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Figura padrão de rosca, com a tabela alternativa para acessibilidade. */
export function DonutCard({ title, description, rows, money = true, centerLabel, empty, labelHeader = "Categoria", action, className }: { title: string; description?: string; rows: DonutRow[]; money?: boolean; centerLabel?: string; empty?: string; labelHeader?: string; action?: ReactNode; className?: string }) {
  const { slices } = toSlices(rows);
  return (
    <figure className={cn("grid content-start gap-3 rounded-xl border bg-surface p-4", className)}>
      <figcaption className="grid gap-1">
        <span className="text-sm font-semibold">{title}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
        {action}
      </figcaption>
      <Donut rows={rows} money={money} centerLabel={centerLabel} empty={empty} />
      {slices.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-primary">Ver dados em tabela</summary>
          <div className="mt-2 max-h-72 overflow-auto">
            <DataTable columns={[{ key: "name", label: labelHeader }, { key: "value", label: money ? "Valor" : "Quantidade", money }, { key: "percentual", label: "Percentual" }]} rows={slices.map((s) => ({ name: s.name, value: s.value, percentual: pct(s.percent) }))} />
          </div>
        </details>
      )}
    </figure>
  );
}

const RING = { success: "var(--success)", danger: "var(--danger)", primary: "var(--primary)", warning: "var(--warning)" };

/** Anel de progresso: quanto do previsto já aconteceu. */
export function ProgressRing({ label, value, total, tone = "primary", hint, size = 112 }: { label: string; value: number; total: number; tone?: keyof typeof RING; hint?: string; size?: number }) {
  const percent = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  const motion = useMotionOk();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    // O anel nasce vazio e cresce até o valor depois de aparecer na tela.
    const t = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(t);
  }, []);
  const counted = useCountUp(percent);
  const stroke = 10;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const visible = !motion || shown ? percent : 0;
  return (
    <div className="grid min-w-0 justify-items-center gap-1.5 text-center" role="img" aria-label={`${label}: ${Math.round(percent)}%. ${formatBRL(value)} de ${formatBRL(total)}.`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={RING[tone]}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - visible / 100)}
            style={{ transition: motion ? "stroke-dashoffset 800ms cubic-bezier(0.22, 1, 0.36, 1)" : undefined }}
          />
        </svg>
        <span className="absolute inset-0 grid place-content-center text-lg font-semibold tabular" aria-hidden="true">
          {Math.round(counted)}%
        </span>
      </div>
      <p className="text-xs font-medium">{label}</p>
      <p className="grid min-w-0 text-xs text-muted-foreground tabular">
        {hint ?? (
          <>
            <span className="whitespace-nowrap">{formatBRL(value)}</span>
            <span className="whitespace-nowrap">de {formatBRL(total)}</span>
          </>
        )}
      </p>
    </div>
  );
}

export type FlowPoint = { label: string; entradas: number; saidas: number; entradasPendentes: number; saidasPendentes: number };

export function FlowCard({ title = "Evolução no tempo", description = "Verde para entradas, vermelho para saídas. Tracejado é o que ainda está pendente.", data, height, showPending, className }: { title?: string; description?: string; data: FlowPoint[]; height?: number; showPending?: boolean; className?: string }) {
  return (
    <figure className={cn("grid content-start gap-3 rounded-xl border bg-surface p-4", className)}>
      <figcaption className="grid gap-1">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </figcaption>
      {data.length === 0 ? <p className="grid h-56 place-items-center text-sm text-muted-foreground">Nada neste período.</p> : <FlowPlot data={data} height={height} showPending={showPending} />}
      {data.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-primary">Ver dados em tabela</summary>
          <div className="mt-2 max-h-72 overflow-auto">
            <DataTable
              columns={[
                { key: "label", label: "Período" },
                { key: "entradas", label: "Entradas recebidas", money: true },
                { key: "saidas", label: "Saídas pagas", money: true },
                { key: "entradasPendentes", label: "Entradas a receber", money: true },
                { key: "saidasPendentes", label: "Saídas a pagar", money: true },
              ]}
              rows={data}
            />
          </div>
        </details>
      )}
    </figure>
  );
}
