import { cn } from "cn";

/**
 * Número que nunca quebra no meio nem vaza do cartão: a fonte diminui conforme o tamanho do texto.
 * Precisa de um pai com a classe @container, que dá a largura disponível.
 */
export function fitSize(text: string, maxRem = 1.5) {
  // Cada caractere ocupa cerca de 0,58 da altura da fonte nos números tabulares.
  return { fontSize: `min(${maxRem}rem, calc(100cqw / ${(Math.max(text.length, 1) * 0.58).toFixed(2)}))` };
}

export function FitNumber({ text, maxRem, className }: { text: string; maxRem?: number; className?: string }) {
  return (
    <span className={cn("block font-semibold tracking-tight whitespace-nowrap tabular", className)} style={fitSize(text, maxRem)}>
      {text}
    </span>
  );
}
