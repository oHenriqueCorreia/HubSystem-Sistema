"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import type { FinanceScope } from "../types";

export function FinanceTabs({ scope, showAdminRead }: { scope: FinanceScope; showAdminRead?: boolean }) {
  const pathname = usePathname();
  const base = `/financeiro/${scope}`;
  const tabs = [
    { href: base, label: "Visão geral" },
    { href: `${base}/dashboard`, label: "Dashboard" },
    { href: `${base}/lancamentos`, label: "Lançamentos" },
    { href: `${base}/importar`, label: "Importar extrato" },
    { href: `${base}/recorrentes`, label: "Fixos e recorrentes" },
    { href: `${base}/fluxo-de-caixa`, label: "Fluxo de caixa" },
    { href: `${base}/cadastros`, label: "Contas e categorias" },
    ...(showAdminRead ? [{ href: `${base}/consulta`, label: "Consultar usuário" }] : []),
  ];
  return (
    <nav aria-label="Seções do financeiro" className="-mx-1 flex gap-1 overflow-x-auto border-b px-1">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap",
              active ? (scope === "pessoal" ? "border-ctx-personal text-foreground" : "border-ctx-company text-foreground") : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
