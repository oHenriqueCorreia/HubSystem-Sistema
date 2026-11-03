import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { getCrmLookups } from "@/features/crm/queries";
import { listAgenda, listClientOptions } from "@/features/tasks/queries";
import { AgendaHub, type SavedAgendaFilter } from "@/features/tasks/components/agenda-hub";
import type { AgendaStatusGroup, AgendaType } from "@/domain/calendar/agenda";
import { CalendarViewClient } from "@/features/tasks/components/calendar-view";
import { viewRange, type CalendarView } from "@/domain/calendar";
import { todayLocal } from "@/domain/shared/dates";

export const metadata: Metadata = { title: "Agenda" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" && v ? v : undefined;
}

export default async function AgendaPage({ searchParams }: PageProps<"/agenda">) {
  const user = await requirePermission("calendar.read");
  const sp = await searchParams;
  const asList = str(sp.visao) === "lista";
  const view = (["dia", "semana", "mes"].includes(str(sp.visao) ?? "") ? str(sp.visao) : "semana") as CalendarView;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(str(sp.data) ?? "") ? str(sp.data)! : todayLocal();
  const range = viewRange(view, day);
  const scope = user.permissions["calendar.read"];

  const responsavel = str(sp.responsavel);
  const [{ items }, lookups, clients] = await Promise.all([
    asList
      ? Promise.resolve({ items: [] })
      : listAgenda(
          { start: range.start, end: range.end },
          { ownerIds: responsavel ? [responsavel] : undefined, type: (str(sp.tipo) as AgendaType) ?? null, clientId: str(sp.cliente) ?? null, status: (str(sp.situacao) as AgendaStatusGroup) ?? null },
        ),
    getCrmLookups(),
    listClientOptions(),
  ]);
  const canManage = Boolean(user.permissions["calendar.manage"]);
  const canAssign = user.permissions["calendar.manage"] === "team" || user.permissions["calendar.manage"] === "all";

  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Trabalho" }, { label: "Agenda" }]} title="Agenda" description="Reuniões, compromissos e tarefas com horário. Clique num horário livre para criar." />
      <PageBody className="grid gap-3">
        <nav aria-label="Modo da agenda" className="flex gap-2 text-sm">
          <Link href="/agenda?visao=lista" aria-current={asList ? "page" : undefined} className={asList ? "font-semibold text-foreground" : "text-primary hover:underline"}>
            Lista e filtros
          </Link>
          <Link href="/agenda" aria-current={asList ? undefined : "page"} className={asList ? "text-primary hover:underline" : "font-semibold text-foreground"}>
            Grade de horários
          </Link>
        </nav>
        {asList ? (
          <AgendaHub
            owners={lookups.owners}
            clients={clients}
            meId={user.id}
            canManageEvents={canManage}
            canAssignEvents={canAssign}
            canEditTasks={Boolean(user.permissions["tasks.update"])}
            canPublish={Boolean(user.permissions["content.publish"])}
            savedFilters={(user.preferences.agenda_filters as SavedAgendaFilter[] | undefined) ?? []}
            initialTab="semana"
          />
        ) : (
        <Suspense>
          <CalendarViewClient
            view={view}
            day={day}
            days={range.days}
            items={items}
            owners={lookups.owners}
            meId={user.id}
            canManage={canManage}
            canAssign={canAssign}
            canSeeOthers={scope === "team" || scope === "all"}
            canEditTasks={Boolean(user.permissions["tasks.update"])}
            canPublish={Boolean(user.permissions["content.publish"])}
            clients={clients}
          />
        </Suspense>
        )}
      </PageBody>
    </>
  );
}
