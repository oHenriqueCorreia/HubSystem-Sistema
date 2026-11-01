import { Suspense } from "react";
import { DashboardFilters } from "@/features/dashboards/components/dashboard-filters";
import { PROVIDER_NAME, type AdsFilters } from "../filters";
import type { AdAccount } from "../queries";

/** Período, plataforma, conta e status (e agrupamento, quando há gráfico). */
export function AdsFilterBar({ accounts, filters, withGroup = false }: { accounts: AdAccount[]; filters: AdsFilters; withGroup?: boolean }) {
  const selected = accounts.filter((a) => a.is_selected);
  const providers = new Set(selected.map((a) => a.provider));
  const extra = [
    ...(providers.size > 1
      ? [
          {
            name: "plataforma",
            label: "Plataforma",
            value: filters.provider === "meta_ads" ? "meta" : filters.provider === "google_ads" ? "google" : "",
            options: [
              ["", "Meta e Google"],
              ["meta", "Meta Ads"],
              ["google", "Google Ads"],
            ] as [string, string][],
          },
        ]
      : []),
    {
      name: "conta",
      label: "Conta",
      value: filters.accountId,
      options: [["", "Todas as contas"], ...selected.map((a) => [a.id, `${a.name} (${PROVIDER_NAME[a.provider]})`] as [string, string])] as [string, string][],
    },
    {
      name: "status",
      label: "Status",
      value: filters.status,
      options: [
        ["", "Qualquer status"],
        ["ativas", "Ativas"],
        ["pausadas", "Pausadas"],
      ] as [string, string][],
    },
    ...(withGroup
      ? [
          {
            name: "agrupar",
            label: "Agrupar por",
            value: filters.group,
            options: [
              ["dia", "Dia"],
              ["semana", "Semana"],
              ["mes", "Mês"],
            ] as [string, string][],
          },
        ]
      : []),
  ];
  return (
    <Suspense>
      <DashboardFilters preset={filters.preset} from={filters.from} to={filters.to} extra={extra} />
    </Suspense>
  );
}
