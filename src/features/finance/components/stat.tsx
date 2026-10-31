import { AlarmClock } from "lucide-react";
import { cn } from "cn";
import { formatBRL } from "@/domain/shared/money";

/** Indicador: rótulo pequeno + número grande; a cor do texto nunca é a de série. */
export function Stat({ label, cents, hint, tone, alert }: { label: string; cents: number; hint?: string; tone?: "positive" | "negative"; alert?: boolean }) {
  return (
    <div className={cn("grid gap-1 rounded-xl border bg-surface p-4", alert && cents > 0 && "border-danger/40")}>
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {alert && cents > 0 && <AlarmClock className="size-3.5 text-danger" aria-hidden="true" />}
        {label}
      </dt>
      <dd className={cn("tabular text-2xl font-semibold tracking-tight", tone === "negative" && cents < 0 && "text-danger", alert && cents > 0 && "text-danger")}>{formatBRL(cents)}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}
