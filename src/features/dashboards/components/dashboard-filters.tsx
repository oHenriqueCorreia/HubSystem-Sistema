"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MobileFilters } from "@/components/app/mobile-filters";
import { cn } from "cn";
import { PRESETS, type Preset } from "../period";

const STORAGE = "hub:dashboard-periodo";

const shortDate = (d: string) => new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`)).replace(/\./g, "");

const chip = (on: boolean) => cn("shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors", on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground");

/** Atalhos numa linha só; mês específico e intervalo abrem quando pedidos. O período escolhido é lembrado. */
export function DashboardFilters({
  preset,
  from,
  to,
  extra,
  presets = PRESETS,
  storageKey = STORAGE,
}: {
  preset: Preset;
  from: string;
  to: string;
  /** Atalhos de período (o padrão serve aos painéis; o financeiro usa os seus). */
  presets?: [Preset, string][];
  /** Onde lembrar o último período escolhido. */
  storageKey?: string;
  extra?: { name: string; label: string; value?: string; options: [string, string][] }[];
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const pickedMonth = preset === "mes" && Boolean(params.get("mes"));
  const [panel, setPanel] = useState<"mes" | "custom" | null>(preset === "custom" ? "custom" : pickedMonth ? "mes" : null);

  useEffect(() => {
    try {
      if (!params.get("periodo")) {
        const saved = localStorage.getItem(storageKey);
        if (saved && saved !== "mes") router.replace(`${pathname}?periodo=${saved}`);
      } else localStorage.setItem(storageKey, params.get("periodo")!);
    } catch {
      /* ignore */
    }
  }, [params, pathname, router, storageKey]);

  const href = (p: Preset) => {
    const q = new URLSearchParams(params.toString());
    q.set("periodo", p);
    q.delete("de");
    q.delete("ate");
    q.delete("mes");
    return `${pathname}?${q.toString()}`;
  };
  const keep = extra?.map((e) => params.get(e.name) && <input key={e.name} type="hidden" name={e.name} value={params.get(e.name) ?? ""} />);

  return (
    <div className="grid min-w-0 gap-2">
      <nav aria-label="Período" className="flex min-w-0 gap-0.5 overflow-x-auto rounded-lg border bg-surface p-0.5 sm:w-fit sm:flex-wrap">
        {presets.map(([p, label]) => {
          const on = preset === p && !pickedMonth;
          return (
            <Link key={p} href={href(p)} scroll={false} onClick={() => setPanel(null)} aria-current={on ? "true" : undefined} className={chip(on)}>
              {label}
            </Link>
          );
        })}
        <button type="button" aria-expanded={panel === "mes"} onClick={() => setPanel((v) => (v === "mes" ? null : "mes"))} className={cn(chip(pickedMonth), "inline-flex items-center gap-1.5")} aria-current={pickedMonth ? "true" : undefined}>
          <CalendarDays className="size-4" aria-hidden="true" /> Escolher mês
        </button>
        <button type="button" aria-expanded={panel === "custom"} onClick={() => setPanel((v) => (v === "custom" ? null : "custom"))} className={cn(chip(preset === "custom"), "inline-flex items-center gap-1.5")} aria-current={preset === "custom" ? "true" : undefined}>
          <CalendarRange className="size-4" aria-hidden="true" /> De… até…
        </button>
      </nav>

      {panel === "mes" && (
        <form className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2 rounded-lg border bg-surface p-2 sm:w-fit" aria-label="Selecionar mês">
          <input type="hidden" name="periodo" value="mes" />
          {keep}
          <div className="grid min-w-0 gap-1">
            <Label htmlFor="d-mes" className="text-xs">
              Mês
            </Label>
            <Input id="d-mes" name="mes" type="month" placeholder="2026-08…" pattern="d{4}-d{2}" defaultValue={from.slice(0, 7)} className="w-full min-w-0 sm:w-44" />
          </div>
          <Button type="submit">Ver mês</Button>
        </form>
      )}
      {panel === "custom" && (
        <form className="grid min-w-0 grid-cols-2 items-end gap-2 rounded-lg border bg-surface p-2 sm:flex sm:w-fit sm:flex-wrap" aria-label="Período personalizado">
          <input type="hidden" name="periodo" value="custom" />
          {keep}
          <div className="grid min-w-0 gap-1">
            <Label htmlFor="d-de" className="text-xs">
              De
            </Label>
            <Input id="d-de" name="de" type="date" defaultValue={from} className="w-full min-w-0 sm:w-40" />
          </div>
          <div className="grid min-w-0 gap-1">
            <Label htmlFor="d-ate" className="text-xs">
              Até
            </Label>
            <Input id="d-ate" name="ate" type="date" defaultValue={to} className="w-full min-w-0 sm:w-40" />
          </div>
          <Button type="submit" className="col-span-2 sm:col-span-1">
            Aplicar período
          </Button>
        </form>
      )}

      <p className="text-xs text-muted-foreground tabular" aria-live="polite">
        Mostrando de {shortDate(from)} a {shortDate(to)}
      </p>

      {extra && extra.length > 0 && (
        <form className="flex min-w-0 flex-wrap items-end gap-2" aria-label="Outros filtros">
          <input type="hidden" name="periodo" value={preset} />
          {pickedMonth && <input type="hidden" name="mes" value={params.get("mes") ?? ""} />}
          {preset === "custom" && (
            <>
              <input type="hidden" name="de" value={from} />
              <input type="hidden" name="ate" value={to} />
            </>
          )}
          <MobileFilters active={extra.filter((e) => e.value).length}>
            {extra.map((e) => (
              <div key={e.name} className="grid min-w-0 gap-1">
                <Label htmlFor={`x-${e.name}`} className="text-xs">
                  {e.label}
                </Label>
                <select id={`x-${e.name}`} name={e.name} defaultValue={e.value ?? ""} className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm sm:w-auto">
                  {e.options.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <Button type="submit" variant="outline" className="max-md:col-span-2">
              Filtrar
            </Button>
          </MobileFilters>
        </form>
      )}
    </div>
  );
}
