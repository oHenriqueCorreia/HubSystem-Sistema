import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/dal";
import { FormAlert } from "@/components/app/form-field";
import { metaConfigured } from "@/lib/ads/meta";
import { googleAdsConfigured } from "@/lib/ads/google-ads";
import { getAdsSetup } from "@/features/ads/queries";
import { getSocialSetup } from "@/features/content/queries";
import Link from "next/link";
import { AccountsList, ProviderCard } from "@/features/ads/components/ads-setup";

export const metadata: Metadata = { title: "Contas · Anúncios" };
// "Sincronizar agora" traz campanhas, conjuntos, anúncios e métricas.
export const maxDuration = 300;

const ERRORS: Record<string, string> = {
  indisponivel: "A integração não está disponível para você ou ainda não foi configurada.",
  cancelado: "A conexão foi cancelada.",
  estado: "A solicitação expirou ou é inválida. Tente conectar novamente.",
  sem_refresh: "O Google não concedeu acesso contínuo. Remova o acesso em myaccount.google.com/permissions e conecte de novo.",
  falha: "Não foi possível concluir a conexão. Verifique as permissões concedidas e tente novamente.",
};

export default async function ContasPage({ searchParams }: PageProps<"/anuncios/contas">) {
  const user = await requirePermission("ads.read");
  const sp = await searchParams;
  const canManage = Boolean(user.permissions["ads.manage"]);
  const [{ connections, accounts, clients }, social] = await Promise.all([getAdsSetup(), getSocialSetup()]);
  const erro = typeof sp.erro === "string" ? ERRORS[sp.erro] : null;

  return (
    <>
      {erro && <FormAlert>{erro}</FormAlert>}
      {sp.conectado && <FormAlert tone="success">Conta conectada. Escolha abaixo quais contas entram nos relatórios.</FormAlert>}
      {(["meta_ads", "google_ads"] as const).map((provider) => (
        <div key={provider} className="grid items-start gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <ProviderCard
            provider={provider}
            configured={provider === "meta_ads" ? metaConfigured() : googleAdsConfigured()}
            connection={connections.find((c) => c.provider === provider)}
            canManage={canManage}
          />
          <AccountsList provider={provider} accounts={accounts.filter((a) => a.provider === provider)} clients={clients} canManage={canManage} />
        </div>
      ))}
      <section aria-labelledby="contas-publicacao" className="grid gap-2 rounded-xl border bg-surface p-4 text-sm">
        <h2 id="contas-publicacao" className="font-semibold">
          Páginas e Instagram para publicar
        </h2>
        {social.accounts.length ? (
          <ul className="grid gap-1">
            {social.accounts.map((a) => (
              <li key={a.id} className="break-words">
                {a.name} ({a.platform === "facebook" ? "Facebook" : "Instagram"}){a.status !== "ativa" ? ", requer reconexão" : a.selected ? "" : ", não selecionada"}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">Nenhuma conta conectada para publicação.</p>
        )}
        <Link href="/conteudo?aba=contas" className="text-primary hover:underline">
          Gerenciar em Conteúdo
        </Link>
      </section>
    </>
  );
}
