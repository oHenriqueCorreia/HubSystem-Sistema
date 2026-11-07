import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/dal";
import { PageHeader } from "@/components/app/page-header";
import { createClient } from "@/lib/supabase/server";
import { clientPeriods, listGroups, periodOf } from "@/lib/ads/reports";
import { todayLocal } from "@/domain/shared/dates";
import { alertSampleVariables, reportVariables, type TemplateKey } from "@/domain/ads/report-message";
import { getReportsPage } from "@/features/ads/report-queries";
import { AccountAlerts, DestinationPanel, SendHistory, TemplatesEditor, type Samples } from "@/features/ads/components/reports-panel";

export const metadata: Metadata = { title: "Alertas e relatórios" };

export default async function RelatoriosPage() {
  const user = await requirePermission("ads.read");
  const canManage = Boolean(user.permissions["ads.manage"]);
  const { settings, accounts, log, numbers } = await getReportsPage(canManage);
  const today = todayLocal();

  // Prévias com os números reais, lidos com o acesso da pessoa (só as contas que ela enxerga).
  const db = (await createClient()) as unknown as Parameters<typeof clientPeriods>[3];
  const kinds = ["semanal", "mensal", "diario"] as const;
  const periods = await Promise.all(
    kinds.map(async (k) => {
      const { from, to } = periodOf(k, today);
      const clients = await clientPeriods(user.organizationId, from, to, db).catch(() => []);
      return [k, clients.map((c) => ({ client: c.client, vars: reportVariables(c, from, to) }))] as const;
    }),
  );
  const sample = accounts.find((a) => a.alert_balance_below_cents != null) ?? accounts[0];
  const alertVars = alertSampleVariables(
    {
      name: sample?.name ?? "Conta do cliente",
      client: sample?.client ?? null,
      provider: sample?.provider ?? "meta_ads",
      status: sample?.status ?? "Ativa",
      isPrepay: sample?.is_prepay ?? true,
      balanceCents: sample?.balance_cents ?? null,
      limitCents: sample?.alert_balance_below_cents ?? null,
    },
    periodOf("diario", today).to,
  );
  const samples: Samples = Object.fromEntries([
    ...periods,
    ...Object.entries(alertVars).map(([k, vars]) => [k, [{ client: sample?.name ?? "Exemplo", vars }]]),
  ]) as Record<TemplateKey, { client: string; vars: Record<string, string> }[]>;

  // Primeira configuração com um só WhatsApp: os grupos já vêm prontos para escolher.
  const only = canManage && !settings?.group_id && numbers.length === 1 ? numbers[0].id : null;
  const initialGroups = only ? await listGroups(user.organizationId, only).catch(() => null) : null;
  const initial = only && initialGroups ? { numberId: only, groups: initialGroups } : null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Trabalho" }, { label: "Alertas e relatórios" }]}
        title="Alertas e relatórios"
        description="Os resultados de cada cliente e os avisos das contas de anúncio, enviados no horário certo para o grupo do WhatsApp."
      />
      <div className="grid gap-10 px-4 pt-2 pb-10 sm:px-6">
        <DestinationPanel settings={settings} numbers={numbers} canManage={canManage} initial={initial} />
        <TemplatesEditor custom={settings?.templates ?? {}} samples={samples} groupName={settings?.group_name ?? null} canManage={canManage} />
        <AccountAlerts accounts={accounts} canManage={canManage} />
        <SendHistory log={log} />
      </div>
    </>
  );
}
