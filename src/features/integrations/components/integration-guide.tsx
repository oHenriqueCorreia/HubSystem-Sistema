"use client";

import { useState } from "react";
import { CalendarClock, CircleHelp, ExternalLink, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { whatsappLink } from "@/domain/shared/phone";
import { publicEnv } from "@/lib/env";
import { GUIDES, meetingMessage, supportMessage, type GuideLink, type IntegrationId } from "../guides";

function Links({ links }: { links?: GuideLink[] }) {
  if (!links?.length) return null;
  return (
    <span className="mt-1 grid justify-items-start gap-1">
      {links.map((l) => (
        <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 text-sm font-medium text-primary hover:underline">
          {l.label} <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="sr-only">(abre em outra aba)</span>
        </a>
      ))}
    </span>
  );
}

/** WhatsApp e reunião com o suporte. Sem número configurado, não promete um canal que não existe. */
export function SupportActions({ name }: { name: string }) {
  const phone = publicEnv.NEXT_PUBLIC_SUPPORT_WHATSAPP;
  const meeting = publicEnv.NEXT_PUBLIC_SUPPORT_MEETING_URL;
  if (!phone && !meeting) return <p className="text-sm text-muted-foreground">Fale com o responsável pelo sistema na sua empresa.</p>;
  return (
    <div className="flex flex-wrap gap-2 *:flex-auto">
      {phone && (
        <Button asChild>
          <a href={whatsappLink(phone, supportMessage(name))} target="_blank" rel="noopener noreferrer">
            <MessageCircle aria-hidden="true" /> Tirar dúvida no WhatsApp
          </a>
        </Button>
      )}
      {(meeting || phone) && (
        <Button asChild variant="outline">
          <a href={meeting || whatsappLink(phone!, meetingMessage(name))} target="_blank" rel="noopener noreferrer">
            <CalendarClock aria-hidden="true" /> Marcar reunião de suporte
          </a>
        </Button>
      )}
    </div>
  );
}

export function IntegrationGuide({ id, defaultOpen = false, label = "Ver passo a passo", variant = "outline" }: { id: IntegrationId; defaultOpen?: boolean; label?: string; variant?: "outline" | "ghost" | "link" }) {
  const [open, setOpen] = useState(defaultOpen);
  const guide = GUIDES[id];
  return (
    <>
      <Button type="button" variant={variant} size="sm" className="justify-self-start" aria-label={`${label}: ${guide.name}`} onClick={() => setOpen(true)}>
        <CircleHelp aria-hidden="true" /> {label}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="pr-6">Como conectar: {guide.name}</SheetTitle>
            <SheetDescription>{guide.purpose}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-6 px-4 pb-6 text-sm">
            <section aria-labelledby="guia-antes" className="grid gap-2">
              <h3 id="guia-antes" className="font-semibold">
                Antes de começar, você precisa de
              </h3>
              <ul className="grid list-disc gap-1 pl-5">
                {guide.before.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="guia-passos" className="grid gap-3">
              <h3 id="guia-passos" className="font-semibold">
                Passo a passo
              </h3>
              <ol className="grid gap-4">
                {guide.steps.map((s, i) => (
                  <li key={s.title} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2">
                    <span aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-muted text-xs font-semibold tabular">
                      {i + 1}
                    </span>
                    <div className="grid gap-0.5">
                      <p className="font-medium">{s.title}</p>
                      <p className="text-muted-foreground">{s.detail}</p>
                      <Links links={s.links} />
                    </div>
                  </li>
                ))}
              </ol>
            </section>
            <section aria-labelledby="guia-erros" className="grid gap-2">
              <h3 id="guia-erros" className="font-semibold">
                Se algo der errado
              </h3>
              <div className="grid gap-2">
                {guide.problems.map((p) => (
                  <details key={p.problem} className="rounded-lg border p-3">
                    <summary className="cursor-pointer font-medium">{p.problem}</summary>
                    <p className="mt-2 text-muted-foreground">{p.solution}</p>
                    <Links links={p.links} />
                  </details>
                ))}
              </div>
            </section>
            <section aria-labelledby="guia-suporte" className="grid gap-2 rounded-lg bg-muted/50 p-3">
              <h3 id="guia-suporte" className="font-semibold">
                Ainda com dúvida?
              </h3>
              <SupportActions name={guide.name} />
            </section>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
