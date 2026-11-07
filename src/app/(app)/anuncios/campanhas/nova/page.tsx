import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/dal";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { getAdsSetup } from "@/features/ads/queries";
import { NewCampaignForm } from "@/features/ads/components/new-campaign-form";

export const metadata: Metadata = { title: "Nova campanha · Anúncios" };
// Envio da imagem e criação em quatro etapas na Meta.
export const maxDuration = 60;

export default async function NovaCampanhaPage() {
  await requirePermission("ads.manage");
  const { accounts, connections } = await getAdsSetup();
  const meta = accounts.filter((a) => a.provider === "meta_ads" && a.is_selected);
  const connected = connections.some((c) => c.provider === "meta_ads" && c.status === "ativa");

  return (
    <div className="grid gap-4">
      <Link href="/anuncios/campanhas" className="inline-flex items-center gap-1 justify-self-start text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden="true" /> Campanhas
      </Link>
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Nova campanha na Meta</h2>
        <p className="text-sm text-muted-foreground">Campanha, público e anúncio de uma vez. Use “Conferir com a Meta” para validar antes de criar.</p>
      </div>
      {!connected || !meta.length ? (
        <EmptyState
          title="Nenhuma conta da Meta disponível"
          description="Conecte a Meta e ative “Nos relatórios” na conta onde a campanha vai ser criada."
          action={
            <Button asChild>
              <Link href="/anuncios/contas">Ir para Contas</Link>
            </Button>
          }
        />
      ) : (
        <NewCampaignForm accounts={meta.map((a) => ({ id: a.id, name: a.name }))} />
      )}
    </div>
  );
}
