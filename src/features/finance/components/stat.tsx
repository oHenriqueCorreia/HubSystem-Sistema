import { FitNumber } from "@/components/app/fit-number";
import { AlarmClock } from "lucide-react";
import { cn } from "cn";
import { formatBRL } from "@/domain/shared/money";

/** Indicador: rótulo pequeno + número grande; a cor do texto nunca é a de série. */
export function Stat({ label, cents, hint, tone, alert }: { label: string; cents: number; hint?: string; tone?: "positive" | "negative"; alert?: boolean }) {
  return (
    <div className={cn("@container grid min-w-0 gap-1 rounded-xl border bg-surface p-4", alert && cents > 0 && "border-danger/40")}>
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {alert && cents > 0 && <AlarmClock className="size-3.5 text-danger" aria-hidden="true" />}
        {label}
      </dt>
      <dd className={cn("min-w-0", tone === "negative" && cents < 0 && "text-danger", alert && cents > 0 && "text-danger")}><FitNumber text={formatBRL(cents)} /></dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}
