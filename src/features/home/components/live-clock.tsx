"use client";

import { useEffect, useState } from "react";
import { Moon, Sun, Sunrise, Sunset } from "lucide-react";
import { dayPeriod, greetingFor, hourInSaoPaulo } from "@/domain/home";
import { cn } from "@/lib/utils";
import { SegmentDigit } from "./segment-digit";

const MAIN = "h-12 sm:h-16";
const SECONDS = "h-7 sm:h-9";
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
  const time = timeFmt.format(now);
  const evenSecond = Number(time[7]) % 2 === 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" /> {period.label} · {date.charAt(0).toUpperCase() + date.slice(1)}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {greetingFor(hour)}, {firstName}!
        </h1>
      </div>
      <time
        dateTime={now.toISOString()}
        aria-label={`Agora são ${time}, horário de Brasília`}
        className="flex items-end gap-1.5 rounded-xl bg-clock px-4 py-3 ring-1 ring-clock-edge sm:gap-2 sm:px-5 sm:py-4"
      >
        <span className="flex skew-x-[-5deg] items-end gap-1.5 drop-shadow-[0_0_7px_var(--clock-glow)] sm:gap-2">
          <SegmentDigit value={time[0]} className={MAIN} />
          <SegmentDigit value={time[1]} className={MAIN} />
          <span className={cn("flex h-12 flex-col justify-center gap-3 px-0.5 sm:h-16 sm:gap-4", evenSecond ? "opacity-100" : "opacity-30 motion-reduce:opacity-100")}>
            <span className="size-1.5 rounded-[1px] bg-clock-lit sm:size-2" />
            <span className="size-1.5 rounded-[1px] bg-clock-lit sm:size-2" />
          </span>
          <SegmentDigit value={time[3]} className={MAIN} />
          <SegmentDigit value={time[4]} className={MAIN} />
          <span className="w-1 sm:w-1.5" />
          <SegmentDigit value={time[6]} className={SECONDS} />
          <SegmentDigit value={time[7]} className={SECONDS} />
        </span>
      </time>
    </div>
  );
}
