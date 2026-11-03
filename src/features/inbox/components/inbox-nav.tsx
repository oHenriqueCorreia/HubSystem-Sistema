"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

const LINKS = [
  { href: "/atendimento", label: "Conversas" },
  { href: "/atendimento/radar", label: "Radar" },
  { href: "/atendimento/indicadores", label: "Indicadores" },
  { href: "/atendimento/campanhas", label: "Campanhas" },
  { href: "/atendimento/automacoes", label: "Automações" },
  { href: "/atendimento/ajustes", label: "Ajustes" },
];

export function InboxNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Atendimento" className="flex gap-1 overflow-x-auto border-b">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={pathname === l.href ? "page" : undefined}
          className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap", pathname === l.href ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
