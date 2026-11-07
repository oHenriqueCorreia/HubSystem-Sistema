import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/dal";
import { PageHeader } from "@/components/app/page-header";
import { createClient } from "@/lib/supabase/server";
import { buildDaily, buildWeekly, listGroups } from "@/lib/ads/reports";
import { alertsMessage } from "@/domain/ads/report-message";
import { getReportsPage } from "@/features/ads/report-queries";
import { AccountAlerts, DestinationPanel, MessagePreview, SendHistory } from "@/features/ads/components/reports-panel";

export const metadata: Metadata = { title: "Alertas e relatórios" };

export default async function RelatoriosPage() {
  const user = await requirePermission("ads.read");
  const canManage = Boolean(user.permissions["ads.manage"]);
  const { settings, accounts, log, numbers } = await getReportsPage(canManage);

  // Prévia com o cliente da pessoa: mostra só as contas que ela enxerga.
  const db = (await createClient()) as unknown as Parameters<typeof buildDaily>[2];
  const [daily, weekly] = await Promise.all([
    buildDaily(user.organizationId, undefined, db).catch(() => null),
    buildWeekly(user.organizationId, undefined, db).catch(() => null),
  ]);
  // Primeira configuração com um só WhatsApp: os grupos já vêm prontos para escolher.
  const only = canManage && !settings?.group_id && numbers.length === 1 ? numbers[0].id : null;
  const initialGroups = only ? await listGroups(user.organizationId, only).catch(() => null) : null;
  const initial = only && initialGroups ? { numberId: only, groups: initialGroups } : null;
  const sample = accounts[0]?.name ?? "Conta do cliente";
  const alert = alertsMessage([{ title: `${sample} não gastou nada ontem`, detail: "Confira o pagamento e se as campanhas estão ativas." }]);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Trabalho" }, { label: "Alertas e relatórios" }]}
        title="Alertas e relatórios"
        description="Os números das contas de anúncio e os avisos importantes, enviados todo dia para um grupo do WhatsApp."
      />
      <div className="grid gap-8 px-4 pt-2 pb-10 sm:px-6">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <DestinationPanel settings={settings} numbers={numbers} canManage={canManage} initial={initial} />
          <MessagePreview
            groupName={settings?.group_name ?? null}
            previews={{
              diario: daily?.text ?? "Não foi possível montar a prévia agora.",
              semanal: weekly?.text ?? "Não foi possível montar a prévia agora.",
              alerta: alert.text,
            }}
          />
        </div>
        <AccountAlerts accounts={accounts} canManage={canManage} />
        <SendHistory log={log} />
      </div>
    </>
  );
}
