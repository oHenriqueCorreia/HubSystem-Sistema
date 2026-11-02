import type { ReactNode } from "react";
import { LEGAL } from "../config";

export type LegalSection = { id: string; title: string; content: ReactNode };

// Estilo do texto corrido: linhas curtas, entrelinha generosa, listas e links visíveis.
const BODY =
  "grid max-w-[68ch] gap-3 text-[0.9375rem] leading-7 break-words [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_li]:mt-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5";

function Contents({ sections }: { sections: LegalSection[] }) {
  return (
    <ol className="grid gap-1.5 text-sm">
      {sections.map((s, i) => (
        <li key={s.id} className="flex gap-2">
          <span className="tabular w-5 shrink-0 text-right text-muted-foreground">{i + 1}.</span>
          <a href={`#${s.id}`} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            {s.title}
          </a>
        </li>
      ))}
    </ol>
  );
}

/** Documento legal: título, data, resumo opcional, sumário e seções numeradas (cláusulas referenciáveis). */
export function LegalDocument({ title, intro, summary, sections }: { title: string; intro: ReactNode; summary?: ReactNode; sections: LegalSection[] }) {
  return (
    <article className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-x-14">
      <header className="grid max-w-[68ch] gap-3 lg:col-span-2">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h1>
        <p className="text-sm text-muted-foreground">
          Atualizada em {LEGAL.updated}. Responsável: {LEGAL.company}.
        </p>
        <div className={BODY}>{intro}</div>
      </header>

      {summary && <div className="lg:col-span-2">{summary}</div>}

      <aside className="lg:sticky lg:top-8 lg:self-start">
        <details className="rounded-lg border bg-surface p-4 lg:hidden">
          <summary className="cursor-pointer text-sm font-semibold">Nesta página</summary>
          <div className="mt-3">
            <Contents sections={sections} />
          </div>
        </details>
        <nav aria-labelledby="sumario" className="hidden lg:grid lg:gap-3">
          <h2 id="sumario" className="text-sm font-semibold">
            Nesta página
          </h2>
          <Contents sections={sections} />
        </nav>
      </aside>

      <div className="grid gap-10">
        {sections.map((s, i) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-titulo`} className="grid scroll-mt-8 gap-3">
            <h2 id={`${s.id}-titulo`} className="text-lg font-semibold tracking-tight text-balance">
              <span className="tabular text-muted-foreground">{i + 1}.</span> {s.title}
            </h2>
            <div className={BODY}>{s.content}</div>
          </section>
        ))}
      </div>
    </article>
  );
}
