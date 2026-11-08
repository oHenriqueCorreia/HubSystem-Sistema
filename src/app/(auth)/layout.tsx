import Image from "next/image";
import Link from "next/link";
import { Brand } from "@/components/app/brand";
import { LEGAL_PAGES } from "@/features/legal/config";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(420px,48%)_1fr]">
      <aside className="auth-stage relative hidden min-h-dvh flex-col justify-between overflow-hidden p-10 text-white lg:flex xl:p-14" aria-label="Hub System">
        <div className="relative z-10 text-xs font-semibold tracking-[0.22em] text-[#c7ff00]">UM SISTEMA. TODO O TRABALHO.</div>
        <div className="relative z-10 grid gap-8">
          <div className="auth-orbit relative flex h-72 items-center justify-center xl:h-80" aria-hidden="true">
            <span className="auth-panel-shape auth-panel-shape-left" />
            <span className="auth-panel-shape auth-panel-shape-right" />
            <Image src="/brand/logo-hero.png" alt="" width={480} height={135} priority className="auth-logo relative z-10 h-auto w-[min(80%,430px)]" />
          </div>
          <div className="auth-copy max-w-lg">
            <h2 className="text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">Seu trabalho conectado em um só lugar.</h2>
            <p className="mt-4 max-w-md text-sm leading-7 text-white/65">Comercial, tarefas, agenda e resultados em uma experiência feita para manter tudo em movimento.</p>
          </div>
        </div>
        <div className="relative z-10 flex items-center gap-3 text-xs text-white/55">
          <span className="size-2 rounded-full bg-[#c7ff00]" aria-hidden="true" />
          Hub System · Gestão integrada
        </div>
      </aside>
      <div className="flex min-h-dvh flex-col">
        <header className="px-6 pt-6 sm:px-10 sm:pt-9 lg:flex lg:justify-end">
          <Brand className="auth-logo lg:h-10 lg:w-40" />
        </header>
        <main id="conteudo" className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
          <div className="auth-panel w-full max-w-md">{children}</div>
        </main>
        <footer className="grid gap-2 px-6 pb-7 text-xs leading-5 text-muted-foreground sm:px-10">
          <p>Acesso somente por convite. Dúvidas? Fale com o administrador da sua empresa.</p>
          <nav aria-label="Documentos">
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {LEGAL_PAGES.map((p) => (
                <li key={p.href}>
                  <Link href={p.href} className="underline underline-offset-2 hover:text-foreground">
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </footer>
      </div>
    </div>
  );
}
