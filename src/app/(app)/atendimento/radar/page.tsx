import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/dal";
import { PageHeader } from "@/components/app/page-header";
import { getCrmLookups } from "@/features/crm/queries";
import { listCadences } from "@/features/tasks/queries";
import { InboxNav } from "@/features/inbox/components/inbox-nav";
import { RadarList } from "@/features/inbox/components/radar-list";
import { getInboxSetup, listQuickReplies } from "@/features/inbox/queries";
import { getInboxSettings, getRadar } from "@/features/inbox/ops-queries";

export const metadata: Metadata = { title: "Radar do atendimento" };

export default async function RadarPage() {
  const user = await requirePermission("inbox.read");
  const settings = await getInboxSettings();
  // Corte fixado por requisição: o servidor renderiza uma vez a cada acesso.
  // eslint-disable-next-line react-hooks/purity -- página de servidor, sem re-renderização
  const now = Date.now();
  const [radar, setup, lookups, cadences, quickReplies] = await Promise.all([getRadar(settings, now), getInboxSetup(), getCrmLookups(), listCadences(), listQuickReplies()]);
  const names = Object.fromEntries(lookups.owners.map((o) => [o.id, o.full_name || o.email]));
  const providers = Object.fromEntries(setup.numbers.map((n) => [n.id, n.provider]));
  const shared = {
    names,
    providers,
    now,
    quickReplies,
    cadences: cadences.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name })),
    canReply: Boolean(user.permissions["inbox.reply"]),
    canEnroll: Boolean(user.permissions["tasks.create"]),
  };

  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Comercial" }, { label: "Atendimento", href: "/atendimento" }, { label: "Radar" }]} title="Radar do atendimento" description="Conversas abertas que pararam de andar. Os limites ficam em Ajustes." />
      <div className="grid gap-6 px-4 pb-6 sm:px-6">
        <InboxNav />
        <RadarList id="cliente-espera" title="O cliente espera você" empty="Nenhum cliente esperando além do limite." items={radar.waitingUs} {...shared} />
        <RadarList id="voce-espera" title="Você espera o cliente" empty="Nenhuma conversa parada do lado do cliente." items={radar.waitingClient} {...shared} />
      </div>
    </>
  );
}
