import { Skeleton } from "@/components/ui/skeleton";

/**
 * Carregamento só do conteúdo: dentro de uma área com cabeçalho e abas fixos (Anúncios,
 * Financeiro, Configurações), trocar de aba mantém o cabeçalho e as abas na tela.
 */
export function SectionLoading({ cards = 4, rows = 5 }: { cards?: number; rows?: number }) {
  return (
    <div className="grid gap-4" role="status" aria-label="Carregando">
      {cards > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: cards }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      )}
      <div className="grid gap-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
      <span className="sr-only">Carregando…</span>
    </div>
  );
}
