import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Users } from "lucide-react";
import { requirePermission } from "@/lib/auth/dal";
import { EmptyState } from "@/components/app/states";
import { DashboardFilters } from "@/features/dashboards/components/dashboard-filters";
import { Kpi } from "@/features/dashboards/components/kpi";
import { getAdsSetup, getClientsSummary, ratio } from "@/features/ads/queries";
import { filtersQuery, parseAdsFilters } from "@/features/ads/filters";
import { formatMoney, formatPct } from "@/features/ads/format";
import { ProviderTag } from "@/features/ads/components/report";
import { ClientActions, NewClientDialog } from "@/features/ads/components/clients-manager";
import { listClientOptions } from "@/features/squads/queries";

export const metadata: Metadata = { title: "Clientes · Anúncios" };

export default async function ClientesAnunciosPage({ searchParams }: PageProps<"/anuncios/clientes">) {
  const user = await requirePermission("ads.read");
  const canManage = Boolean(user.permissions["ads.manage"]);
  const filters = parseAdsFilters(await searchParams);
  const { accounts, clients } = await getAdsSetup();
  // Clientes do sistema que a pessoa enxerga, para ligar a cada cliente de anúncios.
  const systemClients = canManage && user.permissions["clients.read"] ? await listClientOptions() : [];
  const systemName = new Map(systemClients.map((c) => [c.id, c.name]));
  const taken = clients.map((c) => c.client_id).filter((id): id is string => Boolean(id));
  const summaries = await getClientsSummary(accounts, clients, filters);
  const loose = accounts.filter((a) => a.is_selected && !a.ad_client_id);
  const base = filtersQuery({ ...filters, clientId: undefined, accountId: undefined });

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Suspense>
          <DashboardFilters preset={filters.preset} from={filters.from} to={filters.to} />
        </Suspense>
        {canManage && <NewClientDialog accounts={accounts} systemClients={systemClients} taken={taken} />}
      </div>

      {!clients.length ? (
        <EmptyState
          icon={Users}
          title="Nenhum cliente cadastrado"
          description="Crie um cliente para cada empresa que você atende e escolha as contas de anúncio dela. Cada cliente ganha um painel com investimento, resultados e campanhas."
          action={canManage ? <NewClientDialog accounts={accounts} systemClients={systemClients} taken={taken} /> : undefined}
        />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {summaries.map(({ client, accounts: own, totals, previous, activeCampaigns }) => {
            const inReports = own.filter((a) => a.is_selected);
            const currency = inReports[0]?.currency ?? "BRL";
            return (
              <li key={client.id} className="grid content-start gap-4 rounded-xl border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="grid min-w-0 gap-1">
                    <h2 className="text-base font-semibold break-words">{client.name}</h2>
                    <p className="text-xs text-muted-foreground">
                      {own.length} {own.length === 1 ? "conta" : "contas"}, {activeCampaigns} {activeCampaigns === 1 ? "campanha ativa" : "campanhas ativas"}
                    </p>
                    {client.client_id && (
                      <p className="text-xs">
                        Cliente no sistema:{" "}
                        <Link href={`/clientes/${client.client_id}`} className="font-medium text-primary hover:underline">
                          {systemName.get(client.client_id) ?? "abrir"}
                        </Link>
                      </p>
                    )}
                  </div>
                  {canManage && <ClientActions client={client} systemClients={systemClients} taken={taken} />}
                </div>

                {own.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma conta ligada. Escolha o cliente de cada conta em{" "}
                    <Link href="/anuncios/contas" className="font-medium text-primary hover:underline">
                      Contas e alertas
                    </Link>
                    .
                  </p>
                ) : (
                  <ul className="grid gap-1 text-sm">
                    {own.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="min-w-0 truncate">{a.name}</span>
                        <ProviderTag provider={a.provider} />
                        {!a.is_selected && <span className="text-xs text-warning">fora dos relatórios</span>}
                      </li>
                    ))}
                  </ul>
                )}

                {inReports.length > 0 && (
                  <>
                    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <Kpi label="Investimento" value={totals.spend} previous={previous.spend} money invert />
                      <Kpi label="Conversões" value={Math.round(totals.conversions)} previous={Math.round(previous.conversions)} />
                      <Kpi label="Cliques" value={totals.clicks} previous={previous.clicks} />
                    </dl>
                    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                      <div className="flex gap-1.5">
                        <dt className="text-muted-foreground">CTR</dt>
                        <dd className="tabular">{formatPct(ratio(totals.clicks, totals.impressions))}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-muted-foreground">CPC</dt>
                        <dd className="tabular">{totals.clicks ? formatMoney(totals.spend / totals.clicks, currency) : "—"}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-muted-foreground">Custo por conversão</dt>
                        <dd className="tabular">{totals.conversions ? formatMoney(totals.spend / totals.conversions, currency) : "—"}</dd>
                      </div>
                    </dl>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
                      <Link href={`/anuncios?${base}&cliente=${client.id}`} className="text-primary hover:underline">
                        Abrir painel do cliente
                      </Link>
                      <Link href={`/anuncios/campanhas?${base}&cliente=${client.id}&status=ativas`} className="text-primary hover:underline">
                        Campanhas ativas
                      </Link>
                      <Link href={`/anuncios/criativos?${base}&cliente=${client.id}`} className="text-primary hover:underline">
                        Anúncios
                      </Link>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {loose.length > 0 && clients.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {loose.length} {loose.length === 1 ? "conta nos relatórios está" : "contas nos relatórios estão"} sem cliente: {loose.map((a) => a.name).join(", ")}.
        </p>
      )}
    </>
  );
}
