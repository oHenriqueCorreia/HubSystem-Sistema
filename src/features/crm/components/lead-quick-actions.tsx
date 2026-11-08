"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarPlus, ExternalLink, Globe, ListPlus, MapPin, MessageCircle, Phone, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskFormDialog } from "@/features/tasks/components/task-form-dialog";
import { EventDialog } from "@/features/tasks/components/event-dialog";
import { todayLocal } from "@/domain/shared/dates";

type Owner = { id: string; full_name: string; email: string };

/**
 * Atalhos do lead logo abaixo do título: Google Maps em destaque, conversa no Atendimento,
 * ligar, site, e criar tarefa (cai em Tarefas) ou compromisso (cai na Agenda).
 */
export function LeadQuickActions({
  lead,
  mapsUrl,
  rating,
  reviews,
  phone,
  website,
  conversationId,
  unread,
  owners,
  meId,
  perms,
}: {
  lead: { id: string; name: string };
  mapsUrl: string;
  rating: number | null;
  reviews: number | null;
  phone: string | null;
  website: string | null;
  conversationId: string | null;
  unread: number;
  owners: Owner[];
  meId: string;
  perms: { createTask: boolean; assignTask: boolean; manageCalendar: boolean; assignCalendar: boolean };
}) {
  const [eventOpen, setEventOpen] = useState(false);
  const site = website && /^https?:\/\//i.test(website) ? website : website ? `https://${website}` : null;

  return (
    <nav aria-label={`Atalhos de ${lead.name}`} className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border bg-surface p-2 sm:p-3">
      <Button asChild size="lg" className="gap-2">
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${lead.name} no Google Maps (nova aba)`}>
          <MapPin aria-hidden="true" /> Abrir no Google Maps
          {rating != null && (
            <span className="inline-flex items-center gap-0.5 rounded bg-primary-foreground/15 px-1.5 py-0.5 text-xs">
              <Star className="size-3 fill-current" aria-hidden="true" /> {rating.toLocaleString("pt-BR")}
              {reviews ? <span className="opacity-80">({reviews})</span> : null}
            </span>
          )}
          <ExternalLink className="size-3.5 opacity-80" aria-hidden="true" />
        </a>
      </Button>
      {conversationId && (
        <Button asChild size="lg" variant="outline" className="gap-2">
          <Link href={`/atendimento?conversa=${conversationId}`}>
            <MessageCircle aria-hidden="true" /> Abrir conversa
            {unread > 0 && <span className="rounded-full bg-success px-1.5 text-xs font-semibold text-white">{unread}</span>}
          </Link>
        </Button>
      )}
      {phone && (
        <Button asChild size="lg" variant="outline">
          <a href={`tel:${phone}`}>
            <Phone aria-hidden="true" /> Ligar
          </a>
        </Button>
      )}
      {site && (
        <Button asChild size="lg" variant="outline">
          <a href={site} target="_blank" rel="noopener noreferrer">
            <Globe aria-hidden="true" /> Site
          </a>
        </Button>
      )}
      <span className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
      {perms.createTask && (
        <TaskFormDialog
          owners={owners}
          canAssign={perms.assignTask}
          defaults={{ lead }}
          trigger={
            <Button size="lg" variant="ghost">
              <ListPlus aria-hidden="true" /> Criar tarefa
            </Button>
          }
        />
      )}
      {perms.manageCalendar && (
        <>
          <Button size="lg" variant="ghost" onClick={() => setEventOpen(true)}>
            <CalendarPlus aria-hidden="true" /> Agendar
          </Button>
          {eventOpen && <EventDialog open onOpenChange={setEventOpen} draft={{ date: todayLocal(), time: "10:00", lead }} owners={owners} canAssign={perms.assignCalendar} meId={meId} />}
        </>
      )}
    </nav>
  );
}
