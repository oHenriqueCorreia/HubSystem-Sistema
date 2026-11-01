import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/dal";
import { PageHeader } from "@/components/app/page-header";
import { AdsTabs } from "@/features/ads/components/ads-tabs";

export default async function AnunciosLayout({ children }: LayoutProps<"/anuncios">) {
  await requirePermission("ads.read");
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Trabalho" }, { label: "Anúncios" }]}
        title="Anúncios"
        description="Meta Ads e Google Ads em um só lugar: campanhas, conjuntos, anúncios e resultados, pelas APIs oficiais e somente leitura."
      />
      <div className="px-4 sm:px-6">
        <Suspense>
          <AdsTabs />
        </Suspense>
      </div>
      <div className="grid gap-6 px-4 pt-5 pb-8 sm:px-6">{children}</div>
    </>
  );
}
