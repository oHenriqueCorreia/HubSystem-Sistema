"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "cn";
import { PRESETS, type Preset } from "../period";

const STORAGE = "hub:dashboard-periodo";

/** Filtros numa linha acima dos gráficos; o período escolhido é lembrado. */
export function DashboardFilters({
  preset,
  from,
  to,
  extra,
}: {
  preset: Preset;
  from: string;
  to: string;
  extra?: { name: string; label: string; value?: string; options: [string, string][] }[];
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    try {
      if (!params.get("periodo")) {
        const saved = localStorage.getItem(STORAGE);
        if (saved && saved !== "mes") router.replace(`${pathname}?periodo=${saved}`);
      } else localStorage.setItem(STORAGE, params.get("periodo")!);
    } catch {
      /* ignore */
    }
  }, [params, pathname, router]);

  const href = (p: Preset) => {
    const q = new URLSearchParams(params.toString());
    q.set("periodo", p);
    q.delete("de");
    q.delete("ate");
    return `${pathname}?${q.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <nav aria-label="Período" className="inline-flex flex-wrap rounded-lg border bg-surface p-0.5">
        {PRESETS.map(([p, label]) => (
          <Link
            key={p}
            href={href(p)}
            aria-current={preset === p ? "true" : undefined}
            className={cn("rounded-md px-3 py-1.5 text-sm font-medium", preset === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {label}
          </Link>
        ))}
      </nav>
      <form className="flex flex-wrap items-end gap-2" aria-label="Período personalizado">
        <input type="hidden" name="periodo" value="custom" />
        {extra?.map((e) => params.get(e.name) && <input key={e.name} type="hidden" name={e.name} value={params.get(e.name) ?? ""} />)}
        <div className="grid gap-1">
          <Label htmlFor="d-de" className="text-xs">
            De
          </Label>
          <Input id="d-de" name="de" type="date" defaultValue={from} className="w-40" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="d-ate" className="text-xs">
            Até
          </Label>
          <Input id="d-ate" name="ate" type="date" defaultValue={to} className="w-40" />
        </div>
        <Button type="submit" variant="outline">
          Aplicar
        </Button>
      </form>
      {extra && extra.length > 0 && (
        <form className="flex flex-wrap items-end gap-2" aria-label="Outros filtros">
          <input type="hidden" name="periodo" value={preset} />
          {preset === "custom" && (
            <>
              <input type="hidden" name="de" value={from} />
              <input type="hidden" name="ate" value={to} />
            </>
          )}
          {extra.map((e) => (
            <div key={e.name} className="grid gap-1">
              <Label htmlFor={`x-${e.name}`} className="text-xs">
                {e.label}
              </Label>
              <select id={`x-${e.name}`} name={e.name} defaultValue={e.value ?? ""} className="h-9 rounded-md border bg-background px-2 text-sm">
                {e.options.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <Button type="submit" variant="outline">
            Filtrar
          </Button>
        </form>
      )}
    </div>
  );
}
