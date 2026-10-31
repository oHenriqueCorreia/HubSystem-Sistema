"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/** Registra o service worker e avisa quando a conexão cai ou volta. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
    }
    const off = () => toast.warning("Você está sem internet. Alterações não serão salvas até a conexão voltar.", { id: "rede" });
    const on = () => toast.success("Conexão restabelecida.", { id: "rede" });
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => {
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
    };
  }, []);
  return null;
}
