"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "cn";

const TABS = [
  { href: "/anuncios", label: "Visão geral" },
  { href: "/anuncios/clientes", label: "Clientes" },
  { href: "/anuncios/campanhas", label: "Campanhas" },
  { href: "/anuncios/conjuntos", label: "Conjuntos e grupos" },
  { href: "/anuncios/criativos", label: "Anúncios" },
  { href: "/anuncios/utms", label: "UTMs" },
  { href: "/anuncios/contas", label: "Contas" },
];

// Abas sem filtros de relatório.
const NO_FILTERS = new Set(["/anuncios/contas", "/anuncios/utms"]);

// Filtros que valem para todas as abas de relatório.
const KEEP = ["periodo", "de", "ate", "cliente", "conta", "plataforma", "status"];

export function AdsTabs() {
  const pathname = usePathname();
  const params = useSearchParams();
  const q = new URLSearchParams();
  for (const k of KEEP) if (params.get(k)) q.set(k, params.get(k)!);
  const query = q.toString();

  return (
    <nav aria-label="Seções de anúncios" className="-mx-1 flex gap-1 overflow-x-auto border-b px-1">
      {TABS.map((t) => {
        const active = t.href === "/anuncios" ? pathname === t.href : pathname.startsWith(t.href);
        const href = query && !NO_FILTERS.has(t.href) ? `${t.href}?${query}` : t.href;
        return (
          <Link
            key={t.href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap",
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
