import type { Metadata } from "next";
import { Brand } from "@/components/app/brand";

export const metadata: Metadata = { title: "Sem conexão" };

export default function OfflinePage() {
  return (
    <main id="conteudo" className="flex min-h-dvh flex-col items-center justify-center gap-5 px-4 text-center">
      <Brand />
      <div className="grid max-w-sm gap-1">
        <h1 className="text-xl font-semibold">Você está sem internet</h1>
        <p className="text-sm text-muted-foreground">O HubSystem precisa de conexão para mostrar seus dados. Assim que a internet voltar, recarregue a página.</p>
      </div>
      <a href="/inicio" className="text-sm text-primary underline-offset-4 hover:underline">
        Tentar novamente
      </a>
    </main>
  );
}
