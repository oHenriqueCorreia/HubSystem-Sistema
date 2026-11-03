"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Lista que volta ao mesmo ponto: abrir uma conversa e voltar não joga a pessoa para o topo. */
export function ScrollMemory({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  const box = useRef<HTMLUListElement>(null);
  const key = `hub:rolagem:${id}`;

  useEffect(() => {
    try {
      const saved = Number(sessionStorage.getItem(key));
      if (saved && box.current) box.current.scrollTop = saved;
    } catch {
      /* sem armazenamento: só não lembra a posição */
    }
  }, [key]);

  return (
    <ul
      ref={box}
      className={className}
      onScroll={(e) => {
        try {
          sessionStorage.setItem(key, String(e.currentTarget.scrollTop));
        } catch {
          /* idem */
        }
      }}
    >
      {children}
    </ul>
  );
}
