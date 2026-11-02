import type { Metadata } from "next";
import { Download } from "lucide-react";
import { requirePermission } from "@/lib/auth/dal";
import { Button } from "@/components/ui/button";
import { getAdsSetup, getCampaignsReport } from "@/features/ads/queries";
import { filtersQuery, parseAdsFilters } from "@/features/ads/filters";
import { AdsFilterBar } from "@/features/ads/components/ads-filter-bar";
import { MetricsTable, MixedCurrencyAlert, NameCell, NoAccounts, reportCurrency } from "@/features/ads/components/report";

export const metadata: Metadata = { title: "Campanhas · Anúncios" };

export default async function CampanhasPage({ searchParams }: PageProps<"/anuncios/campanhas">) {
  const user = await requirePermission("ads.read");
  const filters = parseAdsFilters(await searchParams);
  const { accounts, clients } = await getAdsSetup();
  if (!accounts.some((a) => a.is_selected)) return <NoAccounts canManage={Boolean(user.permissions["ads.manage"])} />;

  const campaigns = await getCampaignsReport(accounts, filters);
  const { currency, mixed } = reportCurrency(accounts, filters);
  const query = filtersQuery(filters);
  const exportQuery = new URLSearchParams({ de: filters.from, ate: filters.to });
  for (const [k, v] of new URLSearchParams(query)) if (["conta", "plataforma", "status"].includes(k)) exportQuery.set(k, v);

  return (
    <>
      <AdsFilterBar accounts={accounts} clients={clients} filters={filters} />
      {mixed && <MixedCurrencyAlert />}
      <section aria-labelledby="campanhas" className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="campanhas" className="text-sm font-semibold">
            {campaigns.length.toLocaleString("pt-BR")} {campaigns.length === 1 ? "campanha" : "campanhas"}
          </h2>
          {campaigns.length > 0 && (
            <Button asChild variant="outline" size="sm">
              <a href={`/api/ads/export?${exportQuery}`}>
                <Download aria-hidden="true" /> Exportar CSV
              </a>
            </Button>
          )}
        </div>
        <MetricsTable
          label="Campanhas"
          currency={currency}
          budgetLabel="Orçamento diário"
          empty="Nenhuma campanha com estes filtros. Sincronize em Contas e alertas para atualizar."
          rows={campaigns.map((c) => ({
            key: c.id,
            status: c.status,
            budget: c.daily_budget_cents,
            metrics: c.metrics,
            crm: c.crm,
            name: <NameCell name={c.name} href={`/anuncios/campanhas/${c.id}?${query}`} provider={c.provider} context={c.account} />,
          }))}
        />
      </section>
    </>
  );
}
