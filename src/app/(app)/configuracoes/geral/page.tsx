import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { getOrganization } from "@/features/admin/queries";
import { OrganizationForm } from "@/features/admin/components/forms";

export const metadata: Metadata = { title: "Empresa" };

export default async function GeralPage() {
  await requirePermission("admin.settings");
  const org = await getOrganization();
  const msg = typeof org?.settings?.whatsapp_default_message === "string" ? org.settings.whatsapp_default_message : "";
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Configurações" }, { label: "Empresa" }]} title="Empresa" description="Dados gerais usados em todo o sistema." />
      <PageBody>
        <OrganizationForm name={org?.name ?? ""} whatsappMessage={msg} />
      </PageBody>
    </>
  );
}
