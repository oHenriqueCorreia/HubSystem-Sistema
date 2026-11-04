import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LEGAL, LEGAL_PAGES, mailto } from "@/features/legal/config";

export const metadata: Metadata = {
  title: { absolute: "Hub System: comercial, tarefas, agenda e financeiro em um só lugar" },
  description: "O Hub System é um sistema de gestão para empresas e agências: leads, atendimento pelo WhatsApp, tarefas, agenda, conteúdo, relatórios de anúncios e financeiro.",
};

const AREAS = [
  { name: "Comercial", text: "Acompanhe leads, funis e clientes do primeiro contato ao fechamento." },
  { name: "Atendimento", text: "Responda às conversas do WhatsApp da empresa com toda a equipe no mesmo lugar." },
  { name: "Tarefas", text: "Organize o trabalho da equipe e envie entregas para o cliente aprovar por um link." },
  { name: "Agenda", text: "Veja eventos, tarefas e horários livres da equipe em uma só agenda." },
  { name: "Conteúdo", text: "Agende e publique posts e stories na Página do Facebook e no Instagram." },
  { name: "Anúncios", text: "Acompanhe campanhas, gastos e resultados em relatórios por cliente." },
  { name: "Financeiro", text: "Controle lançamentos, importe extratos e veja os números em painéis." },
];

const CONNECTIONS = [
  { name: "Google Agenda", text: "Cria e atualiza eventos e convites, consulta seus horários livres e lista suas agendas para você escolher quais usar." },
  { name: "Google Ads", text: "Lê contas, campanhas, anúncios e resultados para montar os relatórios. O sistema não altera as suas campanhas." },
  { name: "Facebook e Instagram", text: "Publica os posts e stories que você agendar nas contas que escolher." },
  { name: "Facebook Ads", text: "Lê contas, campanhas e resultados para montar os relatórios. O sistema não altera as suas campanhas." },
];

// As áreas ficam sobre os anéis da marca, alternando entre o anel do meio e o interno.
const orbit = AREAS.map((area, i) => {
  const angle = (2 * Math.PI * i) / AREAS.length - Math.PI / 2;
  const radius = i % 2 === 0 ? 12.5 : 9;
  return { name: area.name, x: (Math.cos(angle) * radius).toFixed(2), y: (Math.sin(angle) * radius).toFixed(2) };
});

function Rows({ items }: { items: { name: string; text: string }[] }) {
  return (
    <dl className="divide-y border-y">
      {items.map((item) => (
        <div key={item.name} className="grid gap-1 py-4 sm:grid-cols-[11rem_1fr] sm:gap-6">
          <dt className="font-medium">{item.name}</dt>
          <dd className="text-muted-foreground">{item.text}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Página pública do endereço principal: quem já entrou no sistema vai direto para /inicio (ver proxy). */
export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-20 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm">
        Pular para o conteúdo
      </a>
      <div className="auth-stage relative overflow-hidden text-white">
        <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 pt-5 sm:px-6">
          <Image src="/brand/logo-hero.png" alt="Hub System" width={480} height={135} priority className="h-9 w-auto" />
          <Button asChild variant="ghost" className="text-white hover:bg-white/10 hover:text-white dark:hover:bg-white/10">
            <Link href="/login">Entrar</Link>
          </Button>
        </header>
        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-8 px-4 pt-12 pb-16 sm:px-6 lg:min-h-[34rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:py-10">
          <div className="max-w-xl">
            <h1 className="text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">Comercial, tarefas, agenda e financeiro da sua empresa em um só lugar.</h1>
            <p className="mt-5 max-w-lg text-lg leading-8 text-pretty text-blue-100/85">O Hub System é um sistema de gestão para empresas e agências acompanharem clientes, equipe e resultados sem pular entre ferramentas.</p>
            <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button asChild size="lg">
                <Link href="/login">Entrar no sistema</Link>
              </Button>
              <p className="text-sm text-blue-100/85">Acesso somente por convite.</p>
            </div>
          </div>
          <div className="relative hidden h-[28rem] lg:block" aria-hidden="true">
            <span className="auth-orbit-ring auth-orbit-ring-one" />
            <span className="auth-orbit-ring auth-orbit-ring-two" />
            <span className="auth-orbit-ring auth-orbit-ring-three" />
            <Image src="/brand/symbol-dark.png" alt="" width={64} height={64} className="auth-logo absolute top-1/2 left-1/2 -mt-8 -ml-8 size-16 object-contain" />
            {orbit.map((o) => (
              <span
                key={o.name}
                style={{ left: `calc(50% + ${o.x}rem)`, top: `calc(50% + ${o.y}rem)` }}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-blue-300/30 bg-[#0b2245] px-3 py-1 text-sm whitespace-nowrap text-blue-50"
              >
                {o.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      <main id="conteudo" className="mx-auto grid w-full max-w-6xl flex-1 gap-14 px-4 py-14 sm:px-6 sm:py-20">
        <section aria-labelledby="areas" className="grid gap-5 lg:grid-cols-[1fr_2fr] lg:gap-10">
          <h2 id="areas" className="text-2xl font-semibold tracking-tight text-balance">
            O que a sua equipe faz no Hub System
          </h2>
          <Rows items={AREAS} />
        </section>
        <section aria-labelledby="conexoes" className="grid gap-5 lg:grid-cols-[1fr_2fr] lg:gap-10">
          <div className="grid content-start gap-3">
            <h2 id="conexoes" className="text-2xl font-semibold tracking-tight text-balance">
              O que o sistema faz com as contas que você conecta
            </h2>
            <p className="text-muted-foreground">
              Só conecta quem quiser, e o acesso pode ser removido a qualquer momento. Veja como tratamos esses dados na{" "}
              <Link href="/privacidade" className="font-medium text-primary underline underline-offset-2">
                Política de Privacidade
              </Link>
              .
            </p>
          </div>
          <Rows items={CONNECTIONS} />
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-x-8 gap-y-3 px-4 py-8 text-sm text-muted-foreground sm:px-6">
          <div className="grid gap-1">
            <p>
              {LEGAL.product} é operado por {LEGAL.company}.
            </p>
            <p>
              Contato:{" "}
              <a href={mailto("Hub System")} className="font-medium text-primary underline underline-offset-2">
                {LEGAL.email}
              </a>
            </p>
          </div>
          <nav aria-label="Documentos">
            <ul className="flex flex-wrap gap-x-5 gap-y-1">
              {LEGAL_PAGES.map((p) => (
                <li key={p.href}>
                  <Link href={p.href} className="underline underline-offset-4 hover:text-foreground">
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </footer>
    </div>
  );
}
