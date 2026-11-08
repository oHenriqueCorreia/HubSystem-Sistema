"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Mensagem nova aparece logo; mudanças só na lista (fotos, contadores) são agrupadas numa atualização.
const MESSAGE_MS = 600;
const LIST_MS = 2500;

/** Atualiza a tela quando chega mensagem ou a conversa muda. A RLS define o que cada pessoa recebe. */
export function InboxRealtime() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let due = 0;
    const schedule = (ms: number) => {
      const at = Date.now() + ms;
      // Uma atualização marcada mais cedo vale para as duas.
      if (timer && due <= at) return;
      clearTimeout(timer);
      due = at;
      timer = setTimeout(() => {
        timer = undefined;
        router.refresh();
      }, ms);
    };
    const channel = supabase
      .channel("atendimento")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => schedule(MESSAGE_MS))
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => schedule(LIST_MS))
      .subscribe();
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
