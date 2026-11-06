import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { getEncodingPreview, listEncodingBatches } from "@/features/admin/maintenance";
import { EncodingRepair } from "@/features/admin/components/encoding-repair";

export const metadata: Metadata = { title: "Manutenção" };

export default async function ManutencaoPage() {
  await requirePermission("admin.settings");
  const [preview, batches] = await Promise.all([getEncodingPreview(), listEncodingBatches()]);
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Configurações" }, { label: "Manutenção" }]} title="Manutenção" description="Correções de dados feitas sob demanda, com pré-visualização e opção de desfazer." />
      <PageBody>
        <EncodingRepair preview={preview} batches={batches} />
      </PageBody>
    </>
  );
}
