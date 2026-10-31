"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

export function SettingsNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Configurações" className="border-b px-4 pt-5 md:border-r md:border-b-0 md:px-3">
      <h2 className="mb-2 hidden px-2 text-xs font-medium text-muted-foreground md:block">Configurações</h2>
      <ul className="-mx-1 flex gap-1 overflow-x-auto pb-2 md:mx-0 md:grid md:pb-0">
        {items.map((i) => {
          const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
          return (
            <li key={i.href} className="shrink-0">
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block rounded-md px-2 py-1.5 text-sm whitespace-nowrap",
                  active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
