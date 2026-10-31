import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "cn";
import { formatBRL } from "@/domain/shared/money";
import { delta } from "../period";

/** Indicador com comparação ao período anterior (ícone + texto, não só cor). */
export function Kpi({
  label,
  value,
  previous,
  money,
  suffix,
  invert,
  hint,
}: {
  label: string;
  value: number;
  previous?: number;
  money?: boolean;
  suffix?: string;
  invert?: boolean;
  hint?: string;
}) {
  const fmt = (v: number) => (money ? formatBRL(v) : `${v.toLocaleString("pt-BR")}${suffix ?? ""}`);
  const d = previous !== undefined ? delta(value, previous) : null;
  const good = d ? (invert ? !d.up : d.up) : true;
  return (
    <div className="grid content-start gap-1 rounded-xl border bg-surface p-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular text-2xl font-semibold tracking-tight">{fmt(value)}</dd>
      {d && (
        <dd className={cn("flex items-center gap-1 text-xs", d.pct === 0 ? "text-muted-foreground" : good ? "text-success" : "text-danger")}>
          {d.pct !== 0 && (d.up ? <TrendingUp className="size-3.5" aria-hidden="true" /> : <TrendingDown className="size-3.5" aria-hidden="true" />)}
          {d.pct === null ? "Sem base anterior" : d.pct === 0 ? "Igual ao período anterior" : `${d.up ? "+" : ""}${d.pct}% vs. período anterior (${fmt(previous!)})`}
        </dd>
      )}
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}
