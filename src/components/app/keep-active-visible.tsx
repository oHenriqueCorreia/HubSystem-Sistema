"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

function Scroller() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    // Abas e filtros que rolam de lado: o item escolhido não pode ficar escondido fora da tela.
    const center = () => {
      for (const el of document.querySelectorAll<HTMLElement>('#conteudo [aria-current="page"], #conteudo [aria-current="true"], #conteudo [aria-selected="true"]')) {
        let box = el.parentElement;
        while (box && box.scrollWidth <= box.clientWidth + 1 && box.id !== "conteudo") box = box.parentElement;
        if (!box || box.id === "conteudo") continue;
        const a = el.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        box.scrollLeft += a.left - b.left - (b.width - a.width) / 2;
      }
    };
    center();
    // A tela pode terminar de montar logo depois: confere de novo.
    const again = setTimeout(center, 300);
    return () => clearTimeout(again);
  }, [pathname, search]);

  return null;
}

export function KeepActiveVisible() {
  return (
    <Suspense fallback={null}>
      <Scroller />
    </Suspense>
  );
}
