import type { ReactNode } from "react";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/states";
import { FormAlert } from "@/components/app/form-field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Kpi } from "@/features/dashboards/components/kpi";
import { formatInt, formatMoney, formatPct, formatRoas } from "../format";
import { PROVIDER_NAME, STATUS_GROUPS, STATUS_LABEL, type AdsFilters, type Provider } from "../filters";
import { ratio, reportAccounts, type AdAccount, type Totals } from "../queries";

/** Moeda dos valores exibidos; avisa quando as contas misturam moedas. */
export function reportCurrency(accounts: AdAccount[], f: AdsFilters) {
  const scoped = reportAccounts(accounts, f);
  return { currency: scoped[0]?.currency ?? "BRL", mixed: new Set(scoped.map((a) => a.currency)).size > 1 };
}

export function MixedCurrencyAlert() {
  return <FormAlert tone="info">As contas selecionadas usam moedas diferentes. Escolha uma conta para ver valores corretos.</FormAlert>;
}

export function NoAccounts({ canManage }: { canManage: boolean }) {
  return (
    <EmptyState
      icon={Megaphone}
      title="Nenhuma conta nos relatórios"
      description={canManage ? "Conecte o Meta Ads ou o Google Ads e ative “Nos relatórios” nas contas que você quer acompanhar." : "Peça a um administrador para conectar as contas de anúncio."}
      action={
        canManage ? (
          <Button asChild>
            <Link href="/anuncios/contas">Conectar contas</Link>
          </Button>
        ) : undefined
      }
    />
  );
}

/** Indicadores principais com comparação ao período anterior. */
export function KpiGrid({ totals, previous }: { totals: Totals; previous: Totals }) {
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi label="Investimento" value={totals.spend} previous={previous.spend} money invert />
      <Kpi label="Impressões" value={totals.impressions} previous={previous.impressions} />
      <Kpi label="Cliques" value={totals.clicks} previous={previous.clicks} />
      <Kpi label="Conversões" value={Math.round(totals.conversions)} previous={Math.round(previous.conversions)} />
      <Kpi label="Valor das conversões" value={totals.conversionValue} previous={previous.conversionValue} money />
      <Kpi label="Alcance (soma diária)" value={totals.reach} previous={previous.reach} hint="Somente Meta. A soma diária conta a mesma pessoa mais de uma vez." />
    </dl>
  );
}

/** Eficiência: custo e retorno por unidade. */
export function EfficiencyGrid({ totals, currency }: { totals: Totals; currency: string }) {
  const money = (c: number) => formatMoney(c, currency);
  const items: [string, string, string?][] = [
    ["CTR", formatPct(ratio(totals.clicks, totals.impressions)), "Cliques ÷ impressões"],
    ["CPC", totals.clicks ? money(totals.spend / totals.clicks) : "—", "Custo por clique"],
    ["CPM", totals.impressions ? money((totals.spend / totals.impressions) * 1000) : "—", "Custo por mil impressões"],
    ["Custo por conversão", totals.conversions ? money(totals.spend / totals.conversions) : "—"],
    ["ROAS", formatRoas(totals.conversionValue, totals.spend), "Valor das conversões ÷ investimento"],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {items.map(([label, value, hint]) => (
        <div key={label} className="grid content-start gap-1 rounded-xl border bg-surface p-4">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="tabular text-xl font-semibold">{value}</dd>
          {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

const ACTIVE = new Set(STATUS_GROUPS.ativas);

export function StatusText({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={cn("size-1.5 rounded-full", ACTIVE.has(status) ? "bg-success" : "bg-muted-foreground/50")} aria-hidden="true" />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function ProviderTag({ provider }: { provider: Provider }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span className={cn("size-2 rounded-sm", provider === "meta_ads" ? "bg-chart-1" : "bg-chart-4")} aria-hidden="true" />
      {PROVIDER_NAME[provider]}
    </span>
  );
}

/** Nome (com link opcional), plataforma e contexto (conta, campanha). */
export function NameCell({ name, href, provider, context }: { name: string; href?: string; provider: Provider; context?: string }) {
  return (
    <div className="grid gap-0.5">
      {href ? (
        <Link href={href} className="font-medium break-words hover:underline">
          {name}
        </Link>
      ) : (
        <span className="font-medium break-words">{name}</span>
      )}
      <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <ProviderTag provider={provider} />
        {context && <span className="truncate">{context}</span>}
      </span>
    </div>
  );
}

export type MetricsRow ={ key: string; name: ReactNode; status: string | null; budget?: number | null; metrics: Totals };

/** Tabela de métricas comum a campanhas, conjuntos e anúncios. */
export function MetricsTable({ label, rows, currency, budgetLabel, empty }: { label: string; rows: MetricsRow[]; currency: string; budgetLabel?: string; empty: string }) {
  const money = (c: number) => formatMoney(c, currency);
  if (!rows.length) return <p className="rounded-xl border border-dashed bg-surface px-4 py-6 text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border bg-surface">
      <Table aria-label={label}>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Status</TableHead>
            {budgetLabel && <TableHead className="text-right">{budgetLabel}</TableHead>}
            <TableHead className="text-right">Investimento</TableHead>
            <TableHead className="text-right">Impressões</TableHead>
            <TableHead className="text-right">Cliques</TableHead>
            <TableHead className="text-right">CTR</TableHead>
            <TableHead className="text-right">CPC</TableHead>
            <TableHead className="text-right">Conversões</TableHead>
            <TableHead className="text-right">Custo/conv.</TableHead>
            <TableHead className="text-right">ROAS</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const m = r.metrics;
            return (
              <TableRow key={r.key}>
                <TableCell className="min-w-56 max-w-80">{r.name}</TableCell>
                <TableCell>
                  <StatusText status={r.status} />
                </TableCell>
                {budgetLabel && <TableCell className="tabular text-right">{r.budget != null ? money(r.budget) : "—"}</TableCell>}
                <TableCell className="tabular text-right font-medium">{money(m.spend)}</TableCell>
                <TableCell className="tabular text-right">{formatInt(m.impressions)}</TableCell>
                <TableCell className="tabular text-right">{formatInt(m.clicks)}</TableCell>
                <TableCell className="tabular text-right">{formatPct(ratio(m.clicks, m.impressions))}</TableCell>
                <TableCell className="tabular text-right">{m.clicks ? money(m.spend / m.clicks) : "—"}</TableCell>
                <TableCell className="tabular text-right">{m.conversions.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</TableCell>
                <TableCell className="tabular text-right">{m.conversions ? money(m.spend / m.conversions) : "—"}</TableCell>
                <TableCell className="tabular text-right">{formatRoas(m.conversionValue, m.spend)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
