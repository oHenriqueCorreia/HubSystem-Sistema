"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "cn";

const TABS = [
  { href: "/crm/leads", label: "Lista" },
  { href: "/crm/funil", label: "Funil" },
] as const;

/** Alterna entre lista e Kanban mantendo os filtros compartilhados. */
export function CrmViewTabs() {
  const pathname = usePathname();
  const params = useSearchParams();
  const keep = new URLSearchParams();
  for (const k of ["q", "responsavel", "segmento", "etiqueta", "funil"]) {
    const v = params.get(k);
    if (v) keep.set(k, v);
  }
  const qs = keep.toString();

  return (
    <nav aria-label="Modo de visualização" className="inline-flex rounded-lg border bg-surface p-0.5">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={qs ? `${t.href}?${qs}` : t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
