import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { getCrmLookups } from "@/features/crm/queries";
import { listAgenda } from "@/features/tasks/queries";
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
  const view = (["dia", "semana", "mes"].includes(str(sp.visao) ?? "") ? str(sp.visao) : "semana") as CalendarView;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(str(sp.data) ?? "") ? str(sp.data)! : todayLocal();
  const range = viewRange(view, day);
  const scope = user.permissions["calendar.read"];

  const [{ items }, lookups] = await Promise.all([
    listAgenda({ start: range.start, end: range.end }, { responsavel: str(sp.responsavel), tipo: str(sp.tipo) }),
    getCrmLookups(),
  ]);

  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Trabalho" }, { label: "Agenda" }]} title="Agenda" description="Reuniões, compromissos e tarefas com horário. Clique num horário livre para criar." />
      <PageBody>
        <Suspense>
          <CalendarViewClient
            view={view}
            day={day}
            days={range.days}
            items={items}
            owners={lookups.owners}
            meId={user.id}
            canManage={Boolean(user.permissions["calendar.manage"])}
            canAssign={user.permissions["calendar.manage"] === "team" || user.permissions["calendar.manage"] === "all"}
            canSeeOthers={scope === "team" || scope === "all"}
          />
        </Suspense>
      </PageBody>
    </>
  );
}
