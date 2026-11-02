import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/dal";
import { getAdLevelReport, getAdsSetup } from "@/features/ads/queries";
import { filtersQuery, parseAdsFilters } from "@/features/ads/filters";
import { AdsFilterBar } from "@/features/ads/components/ads-filter-bar";
import { MetricsTable, MixedCurrencyAlert, NameCell, NoAccounts, reportCurrency } from "@/features/ads/components/report";

export const metadata: Metadata = { title: "Conjuntos e grupos · Anúncios" };

export default async function ConjuntosPage({ searchParams }: PageProps<"/anuncios/conjuntos">) {
  const user = await requirePermission("ads.read");
  const filters = parseAdsFilters(await searchParams);
  const { accounts, clients } = await getAdsSetup();
  if (!accounts.some((a) => a.is_selected)) return <NoAccounts canManage={Boolean(user.permissions["ads.manage"])} />;

  const { adSets } = await getAdLevelReport(accounts, filters);
  const { currency, mixed } = reportCurrency(accounts, filters);
  const query = filtersQuery(filters);

  return (
    <>
      <AdsFilterBar accounts={accounts} clients={clients} filters={filters} />
      {mixed && <MixedCurrencyAlert />}
      <section aria-labelledby="conjuntos" className="grid gap-2">
        <div className="grid gap-1">
          <h2 id="conjuntos" className="text-sm font-semibold">
            {adSets.length.toLocaleString("pt-BR")} {adSets.length === 1 ? "conjunto ou grupo" : "conjuntos e grupos"}
          </h2>
          <p className="text-xs text-muted-foreground">Conjuntos de anúncios na Meta e grupos de anúncios no Google. Os resultados de cada um são a soma dos seus anúncios.</p>
        </div>
        <MetricsTable
          label="Conjuntos e grupos de anúncios"
          currency={currency}
          budgetLabel="Orçamento diário"
          empty="Nenhum conjunto ou grupo com estes filtros. Campanhas Performance Max do Google não têm grupos de anúncios; elas aparecem só em Campanhas."
          rows={adSets.map((s) => ({
            key: s.id,
            status: s.status,
            budget: s.daily_budget_cents,
            metrics: s.metrics,
            crm: s.crm,
            name: (
              <NameCell
                name={s.name}
                href={`/anuncios/campanhas/${s.campaign_id}?${query}#conjunto-${s.id}`}
                provider={s.provider}
                context={`${s.campaign} · ${s.ads} ${s.ads === 1 ? "anúncio" : "anúncios"}`}
              />
            ),
          }))}
        />
      </section>
    </>
  );
}
