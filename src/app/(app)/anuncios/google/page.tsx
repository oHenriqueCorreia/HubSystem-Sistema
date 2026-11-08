import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/dal";
import { cn } from "cn";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/app/form-field";
import { DashboardFilters } from "@/features/dashboards/components/dashboard-filters";
import { getAdsSetup } from "@/features/ads/queries";
import { parseAdsFilters } from "@/features/ads/filters";
import { googleAdsKeywords, googleAdsSearchTerms, type KeywordRow, type SearchTermRow } from "@/lib/ads/google-ads";
import { accessToken, getConnection } from "@/lib/ads/tokens";
import { KeywordsTable, SearchTermsView, SuggestionsView } from "@/features/ads/components/google-panel";

export const metadata: Metadata = { title: "Google Ads · Anúncios" };

const TABS = [
  { key: "palavras", label: "Palavras-chave" },
  { key: "termos", label: "Termos de pesquisa" },
  { key: "sugestoes", label: "Sugestões" },
] as const;

export default async function GooglePage({ searchParams }: PageProps<"/anuncios/google">) {
  const user = await requirePermission("ads.read");
  const canManage = Boolean(user.permissions["ads.manage"]);
  const sp = await searchParams;
  const filters = parseAdsFilters(sp);
  const tab = TABS.find((t) => t.key === sp.aba)?.key ?? "palavras";
  const { accounts } = await getAdsSetup();
  const google = accounts.filter((a) => a.provider === "google_ads" && a.is_selected);

  if (!google.length) {
    return (
      <EmptyState
        title="Nenhuma conta do Google Ads nos relatórios"
        description="Conecte o Google Ads e ative “Nos relatórios” nas contas que você quer acompanhar."
        action={
          <Button asChild>
            <Link href="/anuncios/contas">Ir para Contas</Link>
          </Button>
        }
      />
    );
  }

  const account = google.find((a) => a.id === filters.accountId) ?? google[0];
  // Consulta na hora, com o período escolhido: palavras-chave e termos não ficam guardados no sistema.
  let keywords: KeywordRow[] = [];
  let terms: SearchTermRow[] = [];
  let error: string | null = null;
  try {
    const conn = await getConnection(user.organizationId, "google_ads");
    if (!conn || conn.status !== "ativa") throw Object.assign(new Error("conn"), { reason: "CONEXAO" });
    const token = await accessToken(conn);
    if (tab === "palavras") keywords = await googleAdsKeywords(token, account.external_id, filters.from, filters.to);
    else terms = await googleAdsSearchTerms(token, account.external_id, filters.from, filters.to);
  } catch (e) {
    const reason = (e as { reason?: string }).reason;
    error =
      reason === "CONEXAO"
        ? "A conexão com o Google expirou. Reconecte em Anúncios → Contas."
        : reason === "REQUESTED_METRICS_FOR_MANAGER"
          ? "Esta é uma conta de administrador (MCC): escolha uma das contas de dentro dela."
          : "O Google não respondeu agora. Tente de novo em alguns minutos.";
  }

  const query = (aba: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "aba") q.set(k, v);
    q.set("aba", aba);
    return q.toString();
  };

  return (
    <>
      <Suspense>
        <DashboardFilters
          preset={filters.preset}
          from={filters.from}
          to={filters.to}
          extra={[{ name: "conta", label: "Conta", value: account.id, options: google.map((a) => [a.id, a.name] as [string, string]) }]}
        />
      </Suspense>
      <nav aria-label="Visões do Google Ads" className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1 sm:self-start sm:justify-self-start">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/anuncios/google?${query(t.key)}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              tab === t.key ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {error ? (
        <FormAlert>{error}</FormAlert>
      ) : tab === "palavras" ? (
        <KeywordsTable rows={keywords} accountId={account.id} canManage={canManage} currency={account.currency} />
      ) : tab === "termos" ? (
        <SearchTermsView rows={terms} accountId={account.id} canManage={canManage} currency={account.currency} />
      ) : (
        <SuggestionsView rows={terms} accountId={account.id} canManage={canManage} currency={account.currency} />
      )}
    </>
  );
}
