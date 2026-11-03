"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Sector, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { formatBRL } from "@/domain/shared/money";
import type { CategorySlice } from "@/domain/finance/charge";

// Parte pesada (Recharts): carregada sob demanda. Sem animação para quem pediu menos movimento.
function useMotion() {
  const [motion, setMotion] = useState(false);
  useEffect(() => {
    // Lê a preferência do sistema, que só existe no navegador.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMotion(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  return motion;
}

const compact = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 }).format(cents / 100);
const percent = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export const SLICE_COLORS = ["var(--slice-1)", "var(--slice-2)", "var(--slice-3)", "var(--slice-4)", "var(--slice-5)", "var(--slice-6)", "var(--slice-7)", "var(--slice-8)"];

function SliceTip({ active, payload }: TooltipContentProps<number, string>) {
  const s = payload?.[0]?.payload as CategorySlice | undefined;
  if (!active || !s) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{s.name}</p>
      <p className="tabular">
        {formatBRL(s.value)}, {percent(s.percent)}
      </p>
    </div>
  );
}

export function CategoryPie({ slices, active, onActive }: { slices: CategorySlice[]; active: number | null; onActive: (i: number | null) => void }) {
  const motion = useMotion();
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="name"
          innerRadius="55%"
          outerRadius="85%"
          paddingAngle={1}
          stroke="var(--surface)"
          strokeWidth={2}
          isAnimationActive={motion}
          animationDuration={500}
          onMouseEnter={(_, i) => onActive(i)}
          onMouseLeave={() => onActive(null)}
          shape={(props: unknown) => {
            const p = props as React.ComponentProps<typeof Sector> & { index: number };
            return <Sector {...p} outerRadius={p.index === active ? Number(p.outerRadius) + 6 : p.outerRadius} />;
          }}
        >
          {slices.map((s, i) => (
            <Cell key={s.id} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={SliceTip as never} />
      </PieChart>
    </ResponsiveContainer>
  );
}

const LINE_SERIES = [
  { key: "entradas", label: "Entradas recebidas", color: "var(--success)" },
  { key: "saidas", label: "Saídas pagas", color: "var(--danger)" },
  { key: "entradasPendentes", label: "Entradas a receber", color: "var(--success)", dash: "5 4" },
  { key: "saidasPendentes", label: "Saídas a pagar", color: "var(--danger)", dash: "5 4" },
];

function EvolutionTip({ active, payload, label }: TooltipContentProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{label}</p>
      <ul className="grid gap-0.5">
        {payload.map((p) => {
          const s = LINE_SERIES.find((x) => x.key === p.dataKey);
          return (
            <li key={String(p.dataKey)} className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">{s?.label}</span>
              <span className="tabular font-medium">{formatBRL(Number(p.value ?? 0))}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function EvolutionLines({ data }: { data: { label: string; entradas: number; saidas: number; entradasPendentes: number; saidasPendentes: number }[] }) {
  const motion = useMotion();
  return (
    <div className="grid gap-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda">
        {LINE_SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden="true">
              <line x1="0" y1="3" x2="18" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} minTickGap={16} />
          <YAxis tickFormatter={compact} tickLine={false} axisLine={false} width={64} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
          <Tooltip content={EvolutionTip as never} cursor={{ stroke: "var(--border)" }} />
          {LINE_SERIES.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} dot={{ r: 3 }} activeDot={{ r: 5 }} isAnimationActive={motion} animationDuration={500} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
