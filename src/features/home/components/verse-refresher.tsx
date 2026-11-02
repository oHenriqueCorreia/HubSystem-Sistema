"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { rotationSlot } from "@/domain/home";

// Se o relógio do computador divergir do servidor, tenta de novo sem recarregar a tela sem parar.
const RETRY_MS = 5 * 60_000;

/** Atualiza a tela aberta quando a janela de 2 horas muda, inclusive ao voltar à aba ou acordar o computador. */
export function VerseRefresher({ slot }: { slot: number }) {
  const router = useRouter();
  const lastTry = useRef(0);
  useEffect(() => {
    const check = () => {
      if (document.hidden || rotationSlot() === slot) return;
      if (Date.now() - lastTry.current < RETRY_MS) return;
      lastTry.current = Date.now();
      router.refresh();
    };
    const id = setInterval(check, 30_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router, slot]);
  return null;
}
