"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";

/**
 * No celular, os filtros ficam atrás de um botão para o conteúdo aparecer primeiro.
 * Em telas maiores, não muda nada: os filtros seguem no lugar de sempre.
 */
export function MobileFilters({ active = 0, children }: { active?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" className="w-full md:hidden" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <SlidersHorizontal aria-hidden="true" /> Filtros{active > 0 ? ` (${active})` : ""}
        <ChevronDown className={cn("ml-auto transition-transform", open && "rotate-180")} aria-hidden="true" />
      </Button>
      <div className={cn("w-full md:contents", open ? "grid grid-cols-2 items-end gap-2 [&_[data-slot=select-trigger]]:w-full [&_input]:w-full [&_select]:w-full" : "max-md:hidden")}>{children}</div>
    </>
  );
}
