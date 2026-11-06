import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Registro inexistente ou fora do acesso, dentro do app: o layout já tem o <main>. */
export default function AppNotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-5 px-4 text-center">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Página não encontrada</h1>
        <p className="text-sm text-muted-foreground">O endereço pode estar errado, o registro foi excluído ou ele não está no seu acesso.</p>
      </div>
      <Button asChild>
        <Link href="/inicio">Ir para o início</Link>
      </Button>
    </div>
  );
}
