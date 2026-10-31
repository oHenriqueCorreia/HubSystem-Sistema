import type { Metadata } from "next";
import { Suspense } from "react";
import { Download, Megaphone } from "lucide-react";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { FormAlert } from "@/components/app/form-field";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { ChartFigure, DataTable, SingleLine } from "@/components/app/charts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Kpi } from "@/features/dashboards/components/kpi";
import { DashboardFilters } from "@/features/dashboards/components/dashboard-filters";
import { resolvePeriod } from "@/features/dashboards/period";
import { metaConfigured } from "@/lib/ads/meta";
import { googleAdsConfigured } from "@/lib/ads/google-ads";
import { getAdsReport, getAdsSetup, ratio, type ReportFilters } from "@/features/ads/queries";
import { AccountsList, ProviderCard } from "@/features/ads/components/ads-setup";
import { formatMoney } from "@/features/ads/format";

export const metadata: Metadata = { title: "Anúncios" };

const ERRORS: Record<string, string> = {
  indisponivel: "A integração não está disponível para você ou ainda não foi configurada.",
  cancelado: "A conexão foi cancelada.",
  estado: "A solicitação expirou ou é inválida. Tente conectar novamente.",
  sem_refresh: "O Google não concedeu acesso contínuo. Remova o acesso em myaccount.google.com/permissions e conecte de novo.",
  falha: "Não foi possível concluir a conexão. Verifique as permissões concedidas e tente novamente.",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativa",
  ENABLED: "Ativa",
  PAUSED: "Pausada",
  ARCHIVED: "Arquivada",
  DELETED: "Excluída",
  REMOVED: "Removida",
  CAMPAIGN_PAUSED: "Pausada",
  WITH_ISSUES: "Com problemas",
  IN_PROCESS: "Em processamento",
};

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);
const int = (v: number) => Math.round(v).toLocaleString("pt-BR");

export default async function AnunciosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePermission("ads.read");
  const sp = await searchParams;
  const canManage = Boolean(user.permissions["ads.manage"]);
  const { connections, accounts } = await getAdsSetup();
  const period = resolvePeriod(sp);
  const filters: ReportFilters = {
    ...period,
    accountId: typeof sp.conta === "string" && sp.conta ? sp.conta : undefined,
    status: typeof sp.status === "string" && sp.status ? sp.status : undefined,
    group: sp.agrupar === "semana" || sp.agrupar === "mes" ? sp.agrupar : "dia",
  };
  const selected = accounts.filter((a) => a.is_selected);
  const report = selected.length ? await getAdsReport(accounts, filters) : null;
  const currency = (filters.accountId ? accounts.find((a) => a.id === filters.accountId)?.currency : selected[0]?.currency) ?? "BRL";
  const mixed = !filters.accountId && new Set(selected.map((a) => a.currency)).size > 1;
  const money = (c: number) => formatMoney(c, currency);
  const erro = typeof sp.erro === "string" ? ERRORS[sp.erro] : null;
  const exportHref = `/api/ads/export?${new URLSearchParams({ de: period.from, ate: period.to, ...(filters.accountId ? { conta: filters.accountId } : {}), ...(filters.status ? { status: filters.status } : {}) })}`;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Trabalho" }, { label: "Anúncios" }]}
        title="Anúncios"
        description="Meta Ads e Google Ads em um só lugar, pelas APIs oficiais e somente leitura."
        actions={
          report ? (
            <Button asChild variant="outline">
              <a href={exportHref}>
                <Download aria-hidden="true" /> Exportar CSV
              </a>
            </Button>
          ) : null
        }
      />
      <PageBody className="grid gap-6">
        {erro && <FormAlert>{erro}</FormAlert>}
        {sp.conectado && <FormAlert tone="success">Conta conectada. Escolha abaixo quais contas entram nos relatórios.</FormAlert>}
        <div className="grid gap-4 md:grid-cols-2">
          <ProviderCard provider="meta_ads" configured={metaConfigured()} connection={connections.find((c) => c.provider === "meta_ads")} canManage={canManage} />
          <ProviderCard provider="google_ads" configured={googleAdsConfigured()} connection={connections.find((c) => c.provider === "google_ads")} canManage={canManage} />
        </div>
        <AccountsList accounts={accounts} canManage={canManage} />

        {!selected.length ? (
          <EmptyState icon={Megaphone} title="Nenhuma conta nos relatórios" description="Conecte uma plataforma e ative “Nos relatórios” nas contas que você quer acompanhar." />
        ) : (
          <>
            <Suspense>
              <DashboardFilters
                preset={period.preset}
                from={period.from}
                to={period.to}
                extra={[
                  { name: "conta", label: "Conta", value: filters.accountId, options: [["", "Todas as contas"], ...selected.map((a) => [a.id, a.name] as [string, string])] },
                  {
                    name: "status",
                    label: "Status",
                    value: filters.status,
                    options: [
                      ["", "Qualquer status"],
                      ["ACTIVE", "Ativas (Meta)"],
                      ["ENABLED", "Ativas (Google)"],
                      ["PAUSED", "Pausadas"],
                    ],
                  },
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
            {mixed && <FormAlert>As contas selecionadas usam moedas diferentes. Escolha uma conta para ver valores corretos.</FormAlert>}
            {report && (
              <>
                <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                  <Kpi label="Investimento" value={report.totals.spend} previous={report.previous.spend} money invert />
                  <Kpi label="Impressões" value={report.totals.impressions} previous={report.previous.impressions} />
                  <Kpi label="Cliques" value={report.totals.clicks} previous={report.previous.clicks} />
                  <Kpi label="Conversões" value={Math.round(report.totals.conversions)} previous={Math.round(report.previous.conversions)} />
                  <Kpi label="Alcance (soma diária)" value={report.totals.reach} previous={report.previous.reach} hint="Somente Meta. A soma diária conta a mesma pessoa mais de uma vez." />
                </dl>
                <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div className="grid gap-1 rounded-xl border bg-surface p-4">
                    <dt className="text-xs text-muted-foreground">CTR (cliques/impressões)</dt>
                    <dd className="tabular text-xl font-semibold">{pct(ratio(report.totals.clicks, report.totals.impressions))}</dd>
                  </div>
                  <div className="grid gap-1 rounded-xl border bg-surface p-4">
                    <dt className="text-xs text-muted-foreground">CPC (custo por clique)</dt>
                    <dd className="tabular text-xl font-semibold">{report.totals.clicks ? money(report.totals.spend / report.totals.clicks) : "—"}</dd>
                  </div>
                  <div className="grid gap-1 rounded-xl border bg-surface p-4">
                    <dt className="text-xs text-muted-foreground">CPM (custo por mil impressões)</dt>
                    <dd className="tabular text-xl font-semibold">{report.totals.impressions ? money((report.totals.spend / report.totals.impressions) * 1000) : "—"}</dd>
                  </div>
                  <div className="grid gap-1 rounded-xl border bg-surface p-4">
                    <dt className="text-xs text-muted-foreground">Custo por conversão</dt>
                    <dd className="tabular text-xl font-semibold">{report.totals.conversions ? money(report.totals.spend / report.totals.conversions) : "—"}</dd>
                  </div>
                </dl>
                <ChartFigure
                  title={`Investimento por ${filters.group === "dia" ? "dia" : filters.group === "semana" ? "semana" : "mês"}`}
                  description="Valores informados pelas plataformas."
                  table={
                    <DataTable
                      columns={[
                        { key: "period", label: "Período" },
                        { key: "spend", label: "Investimento", money: true },
                        { key: "clicks", label: "Cliques" },
                        { key: "impressions", label: "Impressões" },
                      ]}
                      rows={report.series}
                    />
                  }
                >
                  <SingleLine data={report.series} xKey="period" yKey="spend" label="Investimento" />
                </ChartFigure>
                <section aria-labelledby="campanhas" className="grid gap-2">
                  <h2 id="campanhas" className="text-sm font-semibold">
                    Campanhas
                  </h2>
                  <div className="overflow-x-auto rounded-xl border bg-surface">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Campanha</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Orçamento diário</TableHead>
                          <TableHead className="text-right">Investimento</TableHead>
                          <TableHead className="text-right">Impressões</TableHead>
                          <TableHead className="text-right">Cliques</TableHead>
                          <TableHead className="text-right">CTR</TableHead>
                          <TableHead className="text-right">Conversões</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.campaigns.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell>
                              <div className="font-medium">{c.name}</div>
                              <div className="text-xs text-muted-foreground">{c.account}</div>
                            </TableCell>
                            <TableCell>{STATUS_LABEL[c.status ?? ""] ?? c.status ?? "—"}</TableCell>
                            <TableCell className="tabular text-right">{c.daily_budget_cents != null ? money(c.daily_budget_cents) : "—"}</TableCell>
                            <TableCell className="tabular text-right">{money(c.metrics.spend)}</TableCell>
                            <TableCell className="tabular text-right">{int(c.metrics.impressions)}</TableCell>
                            <TableCell className="tabular text-right">{int(c.metrics.clicks)}</TableCell>
                            <TableCell className="tabular text-right">{pct(ratio(c.metrics.clicks, c.metrics.impressions))}</TableCell>
                            <TableCell className="tabular text-right">{int(c.metrics.conversions)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {report.campaigns.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma campanha com estes filtros. Sincronize para atualizar.</p>}
                </section>
              </>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
