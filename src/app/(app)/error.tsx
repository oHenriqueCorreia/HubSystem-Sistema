"use client";

import { useEffect } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/app/states";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Só o identificador vai para o log; nada de dados do usuário.
    console.error("[app-error]", error.digest ?? error.message);
  }, [error]);

  const offline = typeof navigator !== "undefined" && !navigator.onLine;

  return (
    <div className="px-4 py-8 sm:px-6">
      <ErrorState
        offline={offline}
        title={offline ? "Você está sem internet" : "Algo deu errado nesta tela"}
        description={
          offline
            ? "Reconecte e tente novamente. Nada do que você salvou foi perdido."
            : "Tente novamente. Se continuar, avise o administrador informando o horário."
        }
        action={
          <Button variant="outline" onClick={reset}>
            <RotateCw aria-hidden="true" /> Tentar novamente
          </Button>
        }
      />
    </div>
  );
}
