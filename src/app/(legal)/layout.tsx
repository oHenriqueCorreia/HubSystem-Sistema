import Link from "next/link";
import { Brand } from "@/components/app/brand";
import { LegalNav } from "@/features/legal/components/legal-nav";
import { LEGAL, mailto } from "@/features/legal/config";

/** Páginas públicas (sem login): Política de Privacidade, Termos de Uso e Exclusão de dados. */
export default function LegalLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-20 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm">
        Pular para o conteúdo
      </a>
      <header className="border-b bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-4 py-3 sm:px-6">
          <Link href="/" aria-label="Hub System: ir para a página inicial" className="rounded-md">
            <Brand className="h-9 w-32" />
          </Link>
          <LegalNav />
        </div>
      </header>
      <main id="conteudo" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        {children}
      </main>
      <footer className="border-t">
        <div className="mx-auto grid max-w-6xl gap-1 px-4 py-8 text-sm text-muted-foreground sm:px-6">
          <p>
            {LEGAL.product} é operado por {LEGAL.company}.
          </p>
          <p>
            Dúvidas sobre privacidade ou seus dados:{" "}
            <a href={mailto("Privacidade · Hub System")} className="font-medium text-primary underline underline-offset-2">
              {LEGAL.email}
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
