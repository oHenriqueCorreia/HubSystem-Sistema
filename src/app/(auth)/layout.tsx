import { Brand } from "@/components/app/brand";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="px-4 pt-6 sm:px-8">
        <Brand />
      </header>
      <main id="conteudo" className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center sm:py-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
      <footer className="px-4 pb-6 text-xs text-muted-foreground sm:px-8">
        Acesso somente por convite. Dúvidas? Fale com o administrador da sua empresa.
      </footer>
    </div>
  );
}
