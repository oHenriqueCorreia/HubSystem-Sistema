"use client";

import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Sector, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { formatBRL } from "@/domain/shared/money";
import { useMotionOk } from "./use-motion";

// Parte pesada (Recharts): carregada sob demanda por round-charts.tsx.
export const SLICE_COLORS = ["var(--slice-1)", "var(--slice-2)", "var(--slice-3)", "var(--slice-4)", "var(--slice-5)", "var(--slice-6)", "var(--slice-7)", "var(--slice-8)"];

export type DonutSlice = { name: string; value: number; percent: number };

export function DonutPlot({ slices, active, onActive, height = 240 }: { slices: DonutSlice[]; active: number | null; onActive: (i: number | null) => void; height?: number }) {
  const motion = useMotionOk();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="name"
          innerRadius="66%"
          outerRadius="88%"
          paddingAngle={slices.length > 1 ? 2 : 0}
          cornerRadius={4}
          startAngle={90}
          endAngle={-270}
          stroke="var(--surface)"
          strokeWidth={2}
          isAnimationActive={motion}
          animationDuration={700}
          animationEasing="ease-out"
          onMouseEnter={(_, i) => onActive(i)}
          onMouseLeave={() => onActive(null)}
          shape={(props: unknown) => {
            const p = props as React.ComponentProps<typeof Sector> & { index: number };
            return <Sector {...p} outerRadius={p.index === active ? Number(p.outerRadius) + 7 : p.outerRadius} />;
          }}
        >
          {slices.map((s, i) => (
            <Cell key={s.name} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

const compact = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 }).format(cents / 100);

export const FLOW_SERIES = [
  { key: "entradas", label: "Entradas recebidas", color: "var(--success)" },
  { key: "saidas", label: "Saídas pagas", color: "var(--danger)" },
  { key: "entradasPendentes", label: "Entradas a receber", color: "var(--success)", dash: "5 4" },
  { key: "saidasPendentes", label: "Saídas a pagar", color: "var(--danger)", dash: "5 4" },
];

function FlowTip({ active, payload, label }: TooltipContentProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{label}</p>
      <ul className="grid gap-0.5">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{FLOW_SERIES.find((x) => x.key === p.dataKey)?.label}</span>
            <span className="tabular font-medium">{formatBRL(Number(p.value ?? 0))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Evolução em área: verde para entradas, vermelho para saídas e tracejado para o que está pendente. */
export function FlowPlot({ data, height = 280, showPending = true }: { data: Record<string, string | number>[]; height?: number; showPending?: boolean }) {
  const motion = useMotionOk();
  const series = showPending ? FLOW_SERIES : FLOW_SERIES.slice(0, 2);
  return (
    <div className="grid gap-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden="true">
              <line x1="0" y1="3" x2="18" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="flow-in" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--success)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="flow-out" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--danger)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--danger)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} minTickGap={16} />
          <YAxis tickFormatter={compact} tickLine={false} axisLine={false} width={64} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
          <Tooltip content={FlowTip as never} cursor={{ stroke: "var(--chart-axis)" }} />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dash}
              fill={s.dash ? "transparent" : s.key === "entradas" ? "url(#flow-in)" : "url(#flow-out)"}
              dot={data.length <= 2 ? { r: 3 } : false}
              activeDot={{ r: 5 }}
              isAnimationActive={motion}
              animationDuration={700}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
