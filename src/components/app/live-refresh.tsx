"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Mantém painéis atualizados sem recarregar a página:
 *   - a cada `intervalMs` enquanto a aba está visível;
 *   - ao voltar para a aba (depois de pelo menos 15 s fora);
 *   - na hora, quando chega mensagem ou muda conversa no WhatsApp (tempo real).
 * A RLS define o que cada pessoa recebe; aqui só se pede a tela de novo.
 */
export function LiveRefresh({ intervalMs = 60_000, realtime = false }: { intervalMs?: number; realtime?: boolean }) {
  const router = useRouter();

  useEffect(() => {
    let last = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      last = Date.now();
      router.refresh();
    };
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 1500);
    };
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last > 15_000) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    const supabase = realtime ? createClient() : null;
    const channel = supabase
      ?.channel("painel")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, soon)
      .subscribe();

    return () => {
      clearInterval(tick);
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [router, intervalMs, realtime]);

  return null;
}
