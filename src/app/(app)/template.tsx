import type { ReactNode } from "react";

/** Recriado a cada tela: dá a entrada suave na troca de página. Só opacidade, para não mexer em nada fixo. */
export default function AppTemplate({ children }: { children: ReactNode }) {
  return <div className="hub-page-enter">{children}</div>;
}
