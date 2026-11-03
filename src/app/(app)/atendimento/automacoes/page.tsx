import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/dal";
import { PageHeader } from "@/components/app/page-header";
import { getCrmLookups } from "@/features/crm/queries";
import { InboxNav } from "@/features/inbox/components/inbox-nav";
import { AutomationsPanel } from "@/features/inbox/components/automations-panel";
import { listAutomations } from "@/features/inbox/ops-queries";

export const metadata: Metadata = { title: "Automações do atendimento" };

export default async function AutomacoesPage() {
  await requirePermission("inbox.manage");
  const [{ automations, problems }, lookups] = await Promise.all([listAutomations(), getCrmLookups()]);
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Comercial" }, { label: "Atendimento", href: "/atendimento" }, { label: "Automações" }]} title="Automações" description="Quando algo acontecer, se a condição valer, o sistema faz o que você definir." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 px-4 pb-6 sm:px-6">
        <InboxNav />
        <AutomationsPanel
          automations={automations as never}
          problems={problems as never}
          owners={lookups.owners}
          tags={lookups.tags.map((t) => ({ id: t.id, name: t.name }))}
          stages={lookups.pipelines.flatMap((p) => p.stages.map((s) => ({ id: s.id, name: `${p.name}: ${s.name}` })))}
        />
      </div>
    </>
  );
}
