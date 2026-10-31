import type { CurrentUser } from "@/lib/auth/dal";
import { getLeadWork, listCadences } from "@/features/tasks/queries";
import { LeadWorkPanel } from "@/features/tasks/components/lead-work-panel";
import type { Owner } from "../types";

/** Tarefas, reuniões e cadências do lead (respeitando as permissões do usuário). */
export async function LeadExtraSections({ lead, user, owners }: { lead: { id: string; name: string }; user: CurrentUser; owners: Owner[] }) {
  const p = user.permissions;
  if (!p["tasks.read"] && !p["calendar.read"]) return null;
  const [work, cadences] = await Promise.all([getLeadWork(lead.id), p["crm.cadences.read"] ? listCadences() : Promise.resolve([])]);
  return (
    <LeadWorkPanel
      lead={lead}
      tasks={work.tasks}
      events={work.events}
      enrollments={work.enrollments}
      cadences={cadences.map((c) => ({ id: c.id, name: c.name, is_active: c.is_active }))}
      owners={owners}
      meId={user.id}
      perms={{
        createTask: Boolean(p["tasks.create"]),
        assignTask: Boolean(p["tasks.create"] && p["tasks.create"] !== "own"),
        deleteTask: Boolean(p["tasks.delete"]),
        manageCalendar: Boolean(p["calendar.manage"]),
        assignCalendar: Boolean(p["calendar.manage"] && p["calendar.manage"] !== "own"),
      }}
    />
  );
}
