import Link from "next/link";
import { Brand } from "@/components/app/brand";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="conteudo" className="flex min-h-dvh flex-col items-center justify-center gap-5 px-4 text-center">
      <Brand />
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Página não encontrada</h1>
        <p className="text-sm text-muted-foreground">O endereço pode estar errado ou o registro foi excluído.</p>
      </div>
      <Button asChild>
        <Link href="/inicio">Ir para o início</Link>
      </Button>
    </main>
  );
}
