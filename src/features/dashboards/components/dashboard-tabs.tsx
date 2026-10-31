"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

export function DashboardTabs({ commercial, financial }: { commercial: boolean; financial: boolean }) {
  const pathname = usePathname();
  const tabs = [commercial && { href: "/dashboards/comercial", label: "Comercial" }, financial && { href: "/dashboards/financeiro", label: "Financeiro" }].filter(Boolean) as { href: string; label: string }[];
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Dashboards" className="flex gap-1 border-b">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={pathname === t.href ? "page" : undefined}
          className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", pathname === t.href ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
