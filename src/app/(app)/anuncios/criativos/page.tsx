import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/dal";
import { cn } from "cn";
import { getAdLevelReport, getAdsSetup } from "@/features/ads/queries";
import { filtersQuery, parseAdsFilters } from "@/features/ads/filters";
import { AdsFilterBar } from "@/features/ads/components/ads-filter-bar";
import { AdCard } from "@/features/ads/components/ad-card";
import { MetricsTable, MixedCurrencyAlert, NameCell, NoAccounts, reportCurrency } from "@/features/ads/components/report";

export const metadata: Metadata = { title: "Anúncios e criativos · Anúncios" };

export default async function CriativosPage({ searchParams }: PageProps<"/anuncios/criativos">) {
  const user = await requirePermission("ads.read");
  const sp = await searchParams;
  const filters = parseAdsFilters(sp);
  const view = sp.ver === "tabela" ? "tabela" : "cartoes";
  const { accounts, clients } = await getAdsSetup();
  if (!accounts.some((a) => a.is_selected)) return <NoAccounts canManage={Boolean(user.permissions["ads.manage"])} />;

  const { ads } = await getAdLevelReport(accounts, filters);
  const { currency, mixed } = reportCurrency(accounts, filters);
  const query = filtersQuery(filters);
  const viewHref = (v: string) => `/anuncios/criativos?${query}${v === "tabela" ? "&ver=tabela" : ""}`;

  return (
    <>
      <AdsFilterBar accounts={accounts} clients={clients} filters={filters} />
      {mixed && <MixedCurrencyAlert />}
      <section aria-labelledby="anuncios" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid gap-1">
            <h2 id="anuncios" className="text-sm font-semibold">
              {ads.length.toLocaleString("pt-BR")} {ads.length === 1 ? "anúncio" : "anúncios"}
            </h2>
            <p className="text-xs text-muted-foreground">Do maior para o menor investimento no período.</p>
          </div>
          <nav aria-label="Modo de exibição" className="inline-flex rounded-lg border bg-surface p-0.5">
            {[
              ["cartoes", "Cartões"],
              ["tabela", "Tabela"],
            ].map(([v, label]) => (
              <Link
                key={v}
                href={viewHref(v)}
                aria-current={view === v ? "true" : undefined}
                className={cn("rounded-md px-3 py-1.5 text-sm font-medium", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        {view === "tabela" ? (
          <MetricsTable
            label="Anúncios"
            currency={currency}
            empty="Nenhum anúncio com estes filtros. Sincronize em Contas e alertas para atualizar."
            rows={ads.map((a) => ({
              key: a.id,
              status: a.status,
              metrics: a.metrics,
              crm: a.crm,
              name: <NameCell name={a.name} href={`/anuncios/campanhas/${a.campaign_id}?${query}`} provider={a.provider} context={a.campaign} />,
            }))}
          />
        ) : ads.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {ads.map((a) => (
              <li key={a.id} className="grid">
                <AdCard ad={a} currency={currency} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed bg-surface px-4 py-6 text-sm text-muted-foreground">Nenhum anúncio com estes filtros. Sincronize em Contas e alertas para atualizar.</p>
        )}
      </section>
    </>
  );
}
