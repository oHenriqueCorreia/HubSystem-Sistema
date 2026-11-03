"use client";

import { useIsMobile } from "@/hooks/use-mobile";
import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ServiceWorkerRegister } from "@/components/app/sw-register";

/** No celular, o aviso aparece no alto: embaixo ele cobriria os botões do formulário. */
function ResponsiveToaster() {
  const mobile = useIsMobile();
  return <Toaster position={mobile ? "top-center" : "bottom-right"} closeButton richColors={false} />;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={300}>
        {children}
        <ResponsiveToaster />
        <ServiceWorkerRegister />
      </TooltipProvider>
    </ThemeProvider>
  );
}
