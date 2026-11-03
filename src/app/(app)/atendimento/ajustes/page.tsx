import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/dal";
import { PageHeader } from "@/components/app/page-header";
import { getCrmLookups } from "@/features/crm/queries";
import { InboxNav } from "@/features/inbox/components/inbox-nav";
import { InboxSettingsPanel } from "@/features/inbox/components/inbox-settings-panel";
import { listQuickReplies } from "@/features/inbox/queries";
import { getInboxSettings, getOperationsSetup } from "@/features/inbox/ops-queries";

export const metadata: Metadata = { title: "Ajustes do atendimento" };

export default async function AjustesPage() {
  await requirePermission("inbox.manage");
  const [quickReplies, settings, ops, lookups] = await Promise.all([listQuickReplies(), getInboxSettings(), getOperationsSetup(), getCrmLookups()]);
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Comercial" }, { label: "Atendimento", href: "/atendimento" }, { label: "Ajustes" }]} title="Ajustes do atendimento" description="Respostas rápidas, limites do radar, cobrança, retorno de vendas e integrações." />
      <div className="grid gap-4 px-4 pb-6 sm:px-6">
        <InboxNav />
        <InboxSettingsPanel quickReplies={quickReplies} settings={settings} ops={ops} pipelines={lookups.pipelines.map((p) => ({ id: p.id, name: p.name }))} />
      </div>
    </>
  );
}
