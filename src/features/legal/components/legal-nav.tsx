"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { LEGAL_PAGES } from "../config";

export function LegalNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Documentos">
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {LEGAL_PAGES.map((p) => {
          const current = pathname === p.href;
          return (
            <li key={p.href}>
              <Link
                href={p.href}
                aria-current={current ? "page" : undefined}
                className={cn("underline-offset-4 hover:text-foreground hover:underline", current ? "font-medium text-foreground underline" : "text-muted-foreground")}
              >
                {p.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
