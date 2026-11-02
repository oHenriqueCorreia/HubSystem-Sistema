import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { getAdsSetup, getUtmLinks } from "@/features/ads/queries";
import { STATUS_GROUPS } from "@/features/ads/filters";
import { UtmBuilder, UtmList } from "@/features/ads/components/utm-builder";

export const metadata: Metadata = { title: "UTMs · Anúncios" };

const ACTIVE = new Set(STATUS_GROUPS.ativas);

export default async function UtmsPage() {
  const user = await requirePermission("ads.read");
  const canManage = Boolean(user.permissions["ads.manage"]);
  const [{ accounts, clients }, links] = await Promise.all([getAdsSetup(), getUtmLinks()]);

  // Campanhas sincronizadas das contas nos relatórios, ativas primeiro, para preencher utm_campaign.
  const selected = accounts.filter((a) => a.is_selected);
  const clientOf = new Map(selected.map((a) => [a.id, a.ad_client_id]));
  const supabase = await createClient();
  const { data } = selected.length
    ? await supabase.from("ad_campaigns").select("id, name, status, account_id").in("account_id", selected.map((a) => a.id)).order("name").limit(1000)
    : { data: [] };
  const campaigns = ((data ?? []) as { id: string; name: string; status: string | null; account_id: string }[])
    .map((c) => ({ id: c.id, name: c.name, clientId: clientOf.get(c.account_id) ?? null, active: ACTIVE.has(c.status ?? "") }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  return (
    <>
      <UtmBuilder clients={clients} campaigns={campaigns} canManage={canManage} />
      <UtmList links={links} clients={clients} canManage={canManage} />
    </>
  );
}
