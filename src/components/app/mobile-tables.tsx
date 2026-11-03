"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * No celular, tabela que não cabe vira cartões: cada linha mostra o nome da coluna ao lado do valor,
 * sem rolar de lado. A aparência fica no CSS (table[data-cards]); aqui só se marca quem precisa.
 */
function mark() {
  if (!window.matchMedia("(max-width: 767px)").matches) return;
  for (const table of document.querySelectorAll<HTMLTableElement>("#conteudo table")) {
    const box = table.parentElement;
    if (!box || table.dataset.cards !== undefined || table.closest("[data-keep-table]")) continue;
    if (table.scrollWidth <= box.clientWidth + 1) continue;
    const heads = [...table.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
    if (!heads.length) continue;
    for (const row of table.querySelectorAll("tbody tr")) {
      [...row.children].forEach((cell, i) => cell.setAttribute("data-label", heads[i] ?? ""));
    }
    table.dataset.cards = "";
  }
}

export function MobileTables() {
  const pathname = usePathname();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Linhas novas (carregar mais, tempo real) também precisam do nome da coluna.
        for (const table of document.querySelectorAll<HTMLTableElement>("#conteudo table[data-cards]")) {
          const heads = [...table.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
          for (const row of table.querySelectorAll("tbody tr")) [...row.children].forEach((cell, i) => cell.setAttribute("data-label", heads[i] ?? ""));
        }
        mark();
      }, 150);
    };
    later();
    const root = document.getElementById("conteudo");
    const observer = new MutationObserver(later);
    if (root) observer.observe(root, { childList: true, subtree: true });
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [pathname]);
  return null;
}
