import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/dal";
import { FormAlert } from "@/components/app/form-field";
import { ChartFigure, DataTable, SingleLine } from "@/components/app/charts";
import { formatDateTime } from "@/domain/shared/dates";
import { DashboardFilters } from "@/features/dashboards/components/dashboard-filters";
import { getAdLevelReport, getAdsOverview, getAdsSetup, getCampaign, type AdRow } from "@/features/ads/queries";
import { filtersQuery, parseAdsFilters, PROVIDER_NAME } from "@/features/ads/filters";
import { formatMoney } from "@/features/ads/format";
import { AdCard } from "@/features/ads/components/ad-card";
import { EfficiencyGrid, KpiGrid, MetricsTable, StatusText } from "@/features/ads/components/report";
import { CrmFunnel } from "@/features/ads/components/crm-funnel";

export const metadata: Metadata = { title: "Campanha · Anúncios" };

const GROUP_LABEL = { dia: "dia", semana: "semana", mes: "mês" } as const;

export default async function CampanhaPage({ params, searchParams }: PageProps<"/anuncios/campanhas/[id]">) {
  await requirePermission("ads.read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const [campaign, { accounts }] = await Promise.all([getCampaign(id), getAdsSetup()]);
  if (!campaign) notFound();
  const account = accounts.find((a) => a.id === campaign.account_id);
  if (!account) notFound();

  const base = parseAdsFilters(sp);
  // Na campanha valem só período e agrupamento; conta, plataforma e status vêm dela.
  const filters = { ...base, accountId: account.id, provider: undefined, status: undefined };
  const [overview, { adSets, ads }] = await Promise.all([getAdsOverview(accounts, filters, campaign.id), getAdLevelReport(accounts, filters, campaign.id)]);
  const money = (c: number) => formatMoney(c, account.currency);
  const backHref = `/anuncios/campanhas?${filtersQuery(base)}`;

  const adsBySet = new Map<string | null, AdRow[]>();
  for (const a of ads) {
    const k = a.ad_set_id && adSets.some((s) => s.id === a.ad_set_id) ? a.ad_set_id : null;
    adsBySet.set(k, [...(adsBySet.get(k) ?? []), a]);
  }
  const groups = [...adSets.map((s) => ({ id: s.id, name: s.name, status: s.status, ads: adsBySet.get(s.id) ?? [] })), ...(adsBySet.get(null)?.length ? [{ id: "sem-conjunto", name: "Sem conjunto", status: null, ads: adsBySet.get(null)! }] : [])];
  const setNoun = account.provider === "meta_ads" ? "Conjuntos de anúncios" : "Grupos de anúncios";

  return (
    <>
      <div className="grid gap-3">
        <Link href={backHref} className="inline-flex items-center gap-1 justify-self-start text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden="true" /> Campanhas
        </Link>
        <div className="grid gap-2">
          <h2 className="text-lg font-semibold tracking-tight break-words">{campaign.name}</h2>
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <div className="flex gap-1.5">
              <dt className="sr-only">Status</dt>
              <dd>
                <StatusText status={campaign.status} />
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Plataforma</dt>
              <dd>{PROVIDER_NAME[account.provider]}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Conta</dt>
              <dd>{account.name}</dd>
            </div>
            {campaign.objective && (
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">{account.provider === "meta_ads" ? "Objetivo" : "Tipo"}</dt>
                <dd>{campaign.objective}</dd>
              </div>
            )}
            {campaign.daily_budget_cents != null && (
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">Orçamento diário</dt>
                <dd className="tabular">{money(campaign.daily_budget_cents)}</dd>
              </div>
            )}
            {campaign.lifetime_budget_cents != null && (
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">Orçamento total</dt>
                <dd className="tabular">{money(campaign.lifetime_budget_cents)}</dd>
              </div>
            )}
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Atualizada em</dt>
              <dd>{formatDateTime(campaign.updated_at)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <Suspense>
        <DashboardFilters
          preset={filters.preset}
          from={filters.from}
          to={filters.to}
          extra={[
            {
              name: "agrupar",
              label: "Agrupar por",
              value: filters.group,
              options: [
                ["dia", "Dia"],
                ["semana", "Semana"],
                ["mes", "Mês"],
              ],
            },
          ]}
        />
      </Suspense>

      {!overview ? (
        <FormAlert tone="info">
          A conta {account.name} não está nos relatórios. Ative “Nos relatórios” em <Link href="/anuncios/contas" className="underline">Contas e alertas</Link> para ver os resultados.
        </FormAlert>
      ) : (
        <>
          <KpiGrid totals={overview.totals} previous={overview.previous} />
          <EfficiencyGrid totals={overview.totals} currency={account.currency} />
          {account.provider === "meta_ads" && <CrmFunnel crm={overview.crm} previous={overview.previousCrm} spend={overview.totals.spend} currency={account.currency} />}
          <ChartFigure
            title={`Investimento por ${GROUP_LABEL[filters.group]}`}
            description="Valores informados pela plataforma."
            table={
              <DataTable
                columns={[
                  { key: "period", label: "Período" },
                  { key: "spend", label: "Investimento", money: true },
                  { key: "impressions", label: "Impressões" },
                  { key: "clicks", label: "Cliques" },
                  { key: "conversions", label: "Conversões" },
                ]}
                rows={overview.series}
              />
            }
          >
            <SingleLine data={overview.series} xKey="period" yKey="spend" label="Investimento" />
          </ChartFigure>

          <section aria-labelledby="conjuntos" className="grid gap-2">
            <h2 id="conjuntos" className="text-sm font-semibold">
              {setNoun}
            </h2>
            <MetricsTable
              label={setNoun}
              currency={account.currency}
              budgetLabel={account.provider === "meta_ads" ? "Orçamento diário" : undefined}
              empty={
                account.provider === "google_ads"
                  ? "Esta campanha não tem grupos de anúncios sincronizados. Campanhas Performance Max não usam grupos; os resultados ficam no total da campanha."
                  : "Esta campanha não tem conjuntos sincronizados. Sincronize em Contas e alertas."
              }
              rows={adSets.map((s) => ({
                key: s.id,
                status: s.status,
                budget: s.daily_budget_cents,
                metrics: s.metrics,
                crm: s.crm,
                name: (
                  <div className="grid gap-0.5">
                    <a href={`#conjunto-${s.id}`} className="font-medium break-words hover:underline">
                      {s.name}
                    </a>
                    <span className="text-xs text-muted-foreground">
                      {s.ads} {s.ads === 1 ? "anúncio" : "anúncios"}
                    </span>
                  </div>
                ),
              }))}
            />
          </section>

          {groups.map((g) => (
            <section key={g.id} id={`conjunto-${g.id}`} aria-labelledby={`t-${g.id}`} className="grid scroll-mt-20 gap-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 id={`t-${g.id}`} className="text-sm font-semibold break-words">
                  {g.name}
                </h3>
                {g.status && (
                  <span className="text-xs">
                    <StatusText status={g.status} />
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {g.ads.length} {g.ads.length === 1 ? "anúncio" : "anúncios"}
                </span>
              </div>
              {g.ads.length ? (
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {g.ads.map((a) => (
                    <li key={a.id} className="grid">
                      <AdCard ad={a} currency={account.currency} showCampaign={false} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum anúncio sincronizado neste conjunto.</p>
              )}
            </section>
          ))}
        </>
      )}
    </>
  );
}
