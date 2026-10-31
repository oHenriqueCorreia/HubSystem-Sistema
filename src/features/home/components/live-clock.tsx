"use client";

import { useEffect, useState } from "react";
import { Moon, Sun, Sunrise, Sunset } from "lucide-react";
import { dayPeriod, greetingFor, hourInSaoPaulo } from "@/domain/home";

const TZ = "America/Sao_Paulo";
const timeFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: TZ });
const dateFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ });

const PERIOD = {
  madrugada: { icon: Moon, label: "Madrugada" },
  manha: { icon: Sunrise, label: "Manhã" },
  tarde: { icon: Sun, label: "Tarde" },
  noite: { icon: Sunset, label: "Noite" },
} as const;

/**
 * Saudação, data e relógio no horário de Brasília, atualizados a cada segundo.
 * O servidor envia o instante inicial para a primeira renderização coincidir.
 */
export function LiveClock({ firstName, serverNow }: { firstName: string; serverNow: number }) {
  const [now, setNow] = useState(() => new Date(serverNow));
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const hour = hourInSaoPaulo(now);
  const period = PERIOD[dayPeriod(hour)];
  const Icon = period.icon;
  const date = dateFmt.format(now);

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" /> {period.label} · {date.charAt(0).toUpperCase() + date.slice(1)}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {greetingFor(hour)}, {firstName}!
        </h1>
      </div>
      <time dateTime={now.toISOString()} className="tabular text-3xl font-semibold tracking-tight sm:text-4xl" aria-label={`Agora são ${timeFmt.format(now)}, horário de Brasília`}>
        <span aria-hidden="true">{timeFmt.format(now)}</span>
      </time>
    </div>
  );
}
