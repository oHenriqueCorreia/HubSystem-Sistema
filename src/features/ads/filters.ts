import { resolvePeriod } from "@/features/dashboards/period";

export type Provider = "meta_ads" | "google_ads";
export type StatusGroup = "ativas" | "pausadas";

export const PROVIDER_NAME: Record<Provider, string> = { meta_ads: "Meta Ads", google_ads: "Google Ads" };

// Status das plataformas agrupados para um filtro único (Meta usa ACTIVE, Google usa ENABLED).
export const STATUS_GROUPS: Record<StatusGroup, string[]> = {
  ativas: ["ACTIVE", "ENABLED"],
  pausadas: ["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"],
};

export const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativa",
  ENABLED: "Ativa",
  PAUSED: "Pausada",
  CAMPAIGN_PAUSED: "Campanha pausada",
  ADSET_PAUSED: "Conjunto pausado",
  ARCHIVED: "Arquivada",
  DELETED: "Excluída",
  REMOVED: "Removida",
  WITH_ISSUES: "Com problemas",
  IN_PROCESS: "Em processamento",
  PENDING_REVIEW: "Em análise",
  DISAPPROVED: "Reprovada",
  PREAPPROVED: "Pré-aprovada",
  PENDING_BILLING_INFO: "Aguardando pagamento",
};

export type AdsFilters = ReturnType<typeof parseAdsFilters>;

/** Filtros atuais como query string, para links entre as abas. */
export function filtersQuery(f: AdsFilters) {
  const q = new URLSearchParams({ periodo: f.preset });
  if (f.preset === "custom") {
    q.set("de", f.from);
    q.set("ate", f.to);
  }
  if (f.clientId) q.set("cliente", f.clientId);
  if (f.accountId) q.set("conta", f.accountId);
  if (f.provider) q.set("plataforma", f.provider === "meta_ads" ? "meta" : "google");
  if (f.status) q.set("status", f.status);
  return q.toString();
}

/** Filtros da área de anúncios, lidos da URL (iguais em todas as abas). */
export function parseAdsFilters(sp: Record<string, string | string[] | undefined>) {
  const one = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const plataforma = one("plataforma");
  const status = one("status");
  const agrupar = one("agrupar");
  return {
    ...resolvePeriod(sp),
    clientId: one("cliente"),
    accountId: one("conta"),
    provider: plataforma === "meta" ? ("meta_ads" as const) : plataforma === "google" ? ("google_ads" as const) : undefined,
    status: status === "ativas" || status === "pausadas" ? (status as StatusGroup) : undefined,
    group: agrupar === "semana" || agrupar === "mes" ? agrupar : ("dia" as "dia" | "semana" | "mes"),
  };
}
