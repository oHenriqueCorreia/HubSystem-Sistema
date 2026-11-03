import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/dal";
import { PageHeader } from "@/components/app/page-header";
import { getCrmLookups } from "@/features/crm/queries";
import { InboxNav } from "@/features/inbox/components/inbox-nav";
import { CampaignsPanel } from "@/features/inbox/components/campaigns-panel";
import { getInboxSetup } from "@/features/inbox/queries";
import { getInboxSettings, listCampaigns } from "@/features/inbox/ops-queries";

export const metadata: Metadata = { title: "Campanhas do WhatsApp" };

export default async function CampanhasPage() {
  await requirePermission("inbox.manage");
  const [campaigns, setup, lookups, settings] = await Promise.all([listCampaigns(), getInboxSetup(), getCrmLookups(), getInboxSettings()]);
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Comercial" }, { label: "Atendimento", href: "/atendimento" }, { label: "Campanhas" }]} title="Campanhas" description="Mensagens para listas de contatos que autorizaram receber, com ritmo controlado." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 px-4 pb-6 sm:px-6">
        <InboxNav />
        <CampaignsPanel
          campaigns={campaigns}
          dailyLimit={settings.campaign_daily_limit}
          numbers={setup.numbers.filter((n) => n.status === "ativo").map((n) => ({ id: n.id, provider: n.provider, label: n.verified_name || n.display_phone || "Número" }))}
          templates={setup.templates.filter((t) => t.status === "APPROVED").map((t) => ({ id: t.id, name: t.name, language: t.language, body: t.components.find((c) => c.type === "BODY")?.text ?? "" }))}
          tags={lookups.tags.map((t) => ({ id: t.id, name: t.name }))}
          stages={lookups.pipelines.flatMap((p) => p.stages.map((s) => ({ id: s.id, name: `${p.name}: ${s.name}` })))}
        />
      </div>
    </>
  );
}
