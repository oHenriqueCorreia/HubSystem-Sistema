import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/dal";
import { ChartFigure, DataTable, GroupedBars, SingleLine } from "@/components/app/charts";
import { getAdsOverview, getAdsSetup, getCampaignsReport, reportAccounts } from "@/features/ads/queries";
import { filtersQuery, parseAdsFilters } from "@/features/ads/filters";
import { AdsFilterBar } from "@/features/ads/components/ads-filter-bar";
import { PlatformCompare } from "@/features/ads/components/platform-compare";
import { EfficiencyGrid, KpiGrid, MetricsTable, MixedCurrencyAlert, NameCell, NoAccounts, reportCurrency } from "@/features/ads/components/report";

export const metadata: Metadata = { title: "Anúncios" };

const GROUP_LABEL = { dia: "dia", semana: "semana", mes: "mês" } as const;

export default async function AnunciosPage({ searchParams }: PageProps<"/anuncios">) {
  const user = await requirePermission("ads.read");
  const filters = parseAdsFilters(await searchParams);
  const { accounts } = await getAdsSetup();
  if (!accounts.some((a) => a.is_selected)) return <NoAccounts canManage={Boolean(user.permissions["ads.manage"])} />;

  const [overview, campaigns] = await Promise.all([getAdsOverview(accounts, filters), getCampaignsReport(accounts, filters)]);
  const { currency, mixed } = reportCurrency(accounts, filters);
  const scoped = reportAccounts(accounts, filters);
  const bothPlatforms = new Set(scoped.map((a) => a.provider)).size > 1;

  return (
    <>
      <AdsFilterBar accounts={accounts} filters={filters} withGroup />
      {mixed && <MixedCurrencyAlert />}
      {!overview ? (
        <p className="text-sm text-muted-foreground">Nenhuma conta corresponde a estes filtros.</p>
      ) : (
        <>
          <KpiGrid totals={overview.totals} previous={overview.previous} />
          <EfficiencyGrid totals={overview.totals} currency={currency} />

          <ChartFigure
            title={`Investimento por ${GROUP_LABEL[filters.group]}`}
            description={bothPlatforms ? "Meta e Google lado a lado. Valores informados pelas plataformas." : "Valores informados pelas plataformas."}
            table={
              <DataTable
                columns={[
                  { key: "period", label: "Período" },
                  { key: "spend", label: "Investimento", money: true },
                  ...(bothPlatforms
                    ? [
                        { key: "meta_spend", label: "Meta Ads", money: true },
                        { key: "google_spend", label: "Google Ads", money: true },
                      ]
                    : []),
                  { key: "clicks", label: "Cliques" },
                  { key: "conversions", label: "Conversões" },
                ]}
                rows={overview.series}
              />
            }
          >
            {bothPlatforms ? (
              <GroupedBars
                data={overview.series}
                xKey="period"
                series={[
                  { key: "meta_spend", label: "Meta Ads", color: "var(--chart-1)" },
                  { key: "google_spend", label: "Google Ads", color: "var(--chart-4)" },
                ]}
              />
            ) : (
              <SingleLine data={overview.series} xKey="period" yKey="spend" label="Investimento" />
            )}
          </ChartFigure>

          {bothPlatforms && <PlatformCompare byProvider={overview.byProvider} currency={currency} />}

          <section aria-labelledby="top-campanhas" className="grid gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="top-campanhas" className="text-sm font-semibold">
                Campanhas com mais investimento
              </h2>
              <Link href={`/anuncios/campanhas?${filtersQuery(filters)}`} className="text-sm font-medium text-primary hover:underline">
                Ver todas as campanhas
              </Link>
            </div>
            <MetricsTable
              label="Campanhas com mais investimento"
              currency={currency}
              empty="Nenhuma campanha com estes filtros. Sincronize em Contas e alertas para atualizar."
              rows={campaigns.slice(0, 5).map((c) => ({
                key: c.id,
                status: c.status,
                metrics: c.metrics,
                name: <NameCell name={c.name} href={`/anuncios/campanhas/${c.id}?${filtersQuery(filters)}`} provider={c.provider} context={c.account} />,
              }))}
            />
          </section>
        </>
      )}
    </>
  );
}
