"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarDays, CheckCircle2, MessageCircle, Video } from "lucide-react";
import { whatsappLink } from "@/domain/shared/phone";
import { formatDateTime } from "@/domain/shared/dates";
import { NextContactBadge } from "@/features/crm/components/chips";
import { TaskItem } from "./task-item";
import { TaskSheet } from "./task-sheet";
import type { Task } from "../types";

type Owner = { id: string; full_name: string; email: string };

const time = (iso: string) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(iso));

export function MyDay({
  open,
  doneToday,
  leads,
  events,
  owners,
  canDelete,
}: {
  open: Task[];
  doneToday: Task[];
  leads: { id: string; name: string; next_contact_at: string; whatsapp_e164: string | null; city: string | null }[];
  events: { id: string; title: string; starts_at: string; ends_at: string; all_day: boolean; location: string | null; meet_url: string | null }[];
  owners: Owner[];
  canDelete: boolean;
}) {
  const [now] = useState(() => Date.now());
  const [selected, setSelected] = useState<Task | null>(null);
  const overdue = open.filter((t) => t.due_at && new Date(t.due_at).getTime() < now);
  const today = open.filter((t) => !overdue.includes(t));
  const next = overdue[0] ?? today[0] ?? null;
  const current = selected ? ([...open, ...doneToday].find((t) => t.id === selected.id) ?? selected) : null;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid content-start gap-8">
        <section aria-labelledby="agora" className="rounded-xl border-l-4 border-signal bg-signal-soft/60 p-4">
          <h2 id="agora" className="text-sm font-semibold">
            Próxima ação
          </h2>
          {next ? (
            <div className="mt-2 grid gap-1">
              <button type="button" className="text-left text-lg font-semibold hover:underline" onClick={() => setSelected(next)}>
                {next.title}
              </button>
              <p className="text-sm text-muted-foreground">
                {next.due_at && (new Date(next.due_at).getTime() < now ? `Atrasada desde ${formatDateTime(next.due_at)}` : `Para ${next.has_time ? `hoje às ${time(next.due_at)}` : "hoje"}`)}
                {next.lead && (
                  <>
                    {" · "}
                    <Link href={`/crm/leads/${next.lead.id}`} className="text-primary hover:underline">
                      {next.lead.name}
                    </Link>
                  </>
                )}
              </p>
            </div>
          ) : (
            <p className="mt-2 flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-success" aria-hidden="true" /> Nada pendente para hoje. Bom momento para prospectar novos leads.
            </p>
          )}
        </section>

        {overdue.length > 0 && (
          <section aria-labelledby="atrasadas" className="grid gap-2">
            <h2 id="atrasadas" className="text-sm font-semibold text-danger">
              Atrasadas <span className="tabular font-normal">({overdue.length})</span>
            </h2>
            <ul className="grid gap-2">
              {overdue.map((t) => (
                <TaskItem key={t.id} task={t} now={now} onOpen={setSelected} />
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="hoje" className="grid gap-2">
          <h2 id="hoje" className="text-sm font-semibold">
            Hoje <span className="tabular font-normal text-muted-foreground">({today.length})</span>
          </h2>
          {today.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma tarefa para hoje.{" "}
              <Link href="/tarefas" className="text-primary hover:underline">
                Ver todas as tarefas
              </Link>
            </p>
          ) : (
            <ul className="grid gap-2">
              {today.map((t) => (
                <TaskItem key={t.id} task={t} now={now} onOpen={setSelected} />
              ))}
            </ul>
          )}
        </section>

        {leads.length > 0 && (
          <section aria-labelledby="contatos" className="grid gap-2">
            <h2 id="contatos" className="text-sm font-semibold">
              Contatos agendados <span className="tabular font-normal text-muted-foreground">({leads.length})</span>
            </h2>
            <ul className="grid gap-2">
              {leads.map((l) => (
                <li key={l.id} className="flex items-center gap-3 rounded-lg border bg-surface px-3 py-2">
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <Link href={`/crm/leads/${l.id}`} className="truncate text-sm font-medium hover:underline">
                      {l.name}
                    </Link>
                    <NextContactBadge at={l.next_contact_at} compact />
                  </div>
                  {l.whatsapp_e164 && (
                    <a href={whatsappLink(l.whatsapp_e164)} target="_blank" rel="noopener noreferrer" className="inline-flex size-8 items-center justify-center rounded-md border hover:bg-muted" aria-label={`WhatsApp de ${l.name}`}>
                      <MessageCircle className="size-4" aria-hidden="true" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {doneToday.length > 0 && (
          <section aria-labelledby="feitas" className="grid gap-2">
            <h2 id="feitas" className="text-sm font-semibold text-muted-foreground">
              Concluídas hoje ({doneToday.length})
            </h2>
            <ul className="grid gap-2">
              {doneToday.map((t) => (
                <TaskItem key={t.id} task={t} now={now} onOpen={setSelected} />
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside aria-labelledby="agenda-hoje" className="grid content-start gap-2">
        <div className="flex items-center justify-between">
          <h2 id="agenda-hoje" className="text-sm font-semibold">
            Agenda de hoje
          </h2>
          <Link href="/agenda?visao=dia" className="text-xs text-primary hover:underline">
            Abrir agenda
          </Link>
        </div>
        {events.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="size-4" aria-hidden="true" /> Sem compromissos hoje.
          </p>
        ) : (
          <ol className="grid gap-2">
            {events.map((e) => (
              <li key={e.id} className="rounded-lg border bg-surface px-3 py-2 text-sm">
                <p className="tabular text-xs text-muted-foreground">{e.all_day ? "Dia inteiro" : `${time(e.starts_at)} – ${time(e.ends_at)}`}</p>
                <p className="font-medium">{e.title}</p>
                {e.location && <p className="text-xs text-muted-foreground">{e.location}</p>}
                {e.meet_url && (
                  <a href={e.meet_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <Video className="size-3.5" aria-hidden="true" /> Entrar na chamada
                  </a>
                )}
              </li>
            ))}
          </ol>
        )}
      </aside>

      <TaskSheet task={current} onClose={() => setSelected(null)} owners={owners} canAssign={false} canDelete={canDelete} />
    </div>
  );
}
