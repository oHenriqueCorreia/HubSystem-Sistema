"use client";

import { useState, useTransition } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormAlert, FormField } from "@/components/app/form-field";
import type { WorkHours } from "@/domain/calendar";
import { saveWorkHours } from "../actions";

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DAY_NAMES = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

/** Expediente usado para calcular horários livres na agenda (fuso de São Paulo). */
export function WorkHoursForm({ initial }: { initial: WorkHours }) {
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [days, setDays] = useState(new Set(initial.days));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await saveWorkHours({ start, end, days: [...days] });
      if (!res.ok) return setError(res.fieldErrors?.end?.[0] ?? res.fieldErrors?.days?.[0] ?? res.message);
      toast.success(res.message);
    });
  }

  return (
    <section aria-labelledby="expediente" className="grid max-w-lg gap-3">
      <div>
        <h2 id="expediente" className="text-sm font-semibold">
          Expediente
        </h2>
        <p className="text-sm text-muted-foreground">Define os horários livres que aparecem ao marcar reuniões. Horário de Brasília.</p>
      </div>
      <form onSubmit={submit} className="grid gap-3" noValidate>
        <FormAlert>{error}</FormAlert>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Início">
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </FormField>
          <FormField label="Fim">
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </FormField>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Dias de trabalho</legend>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => (
              <button
                key={d}
                type="button"
                aria-pressed={days.has(i)}
                aria-label={DAY_NAMES[i]}
                onClick={() =>
                  setDays((cur) => {
                    const next = new Set(cur);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    return next;
                  })
                }
                className={cn("min-h-9 min-w-11 rounded-md border px-2 text-sm", days.has(i) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}
              >
                {d}
              </button>
            ))}
          </div>
        </fieldset>
        <Button type="submit" variant="outline" className="justify-self-start" disabled={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar expediente
        </Button>
      </form>
    </section>
  );
}
