import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/dal";
import { FormAlert } from "@/components/app/form-field";
import { metaConfigured } from "@/lib/ads/meta";
import { googleAdsConfigured } from "@/lib/ads/google-ads";
import { getAdsSetup } from "@/features/ads/queries";
import { AccountsList, ProviderCard } from "@/features/ads/components/ads-setup";

export const metadata: Metadata = { title: "Contas e alertas · Anúncios" };
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
  const { connections, accounts } = await getAdsSetup();
  const erro = typeof sp.erro === "string" ? ERRORS[sp.erro] : null;

  return (
    <>
      {erro && <FormAlert>{erro}</FormAlert>}
      {sp.conectado && <FormAlert tone="success">Conta conectada. Escolha abaixo quais contas entram nos relatórios.</FormAlert>}
      <div className="grid gap-4 md:grid-cols-2">
        <ProviderCard provider="meta_ads" configured={metaConfigured()} connection={connections.find((c) => c.provider === "meta_ads")} canManage={canManage} />
        <ProviderCard provider="google_ads" configured={googleAdsConfigured()} connection={connections.find((c) => c.provider === "google_ads")} canManage={canManage} />
      </div>
      <AccountsList accounts={accounts} canManage={canManage} />
    </>
  );
}
