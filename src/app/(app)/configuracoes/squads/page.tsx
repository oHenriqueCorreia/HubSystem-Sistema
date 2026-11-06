import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { listClientOptions, listPeople, listSquads } from "@/features/squads/queries";
import { SquadsManager } from "@/features/squads/components/squads-manager";

export const metadata: Metadata = { title: "Squads" };

export default async function SquadsPage() {
  await requirePermission("admin.users");
  const [squads, people, clients] = await Promise.all([listSquads(), listPeople(), listClientOptions()]);
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Configurações" }, { label: "Squads" }]}
        title="Squads"
        description="Organize a equipe por clientes. Para associar uma pessoa a um cliente só, use a seção Equipe do cliente na página dele."
      />
      <PageBody>
        <SquadsManager squads={squads} people={people} clients={clients} />
      </PageBody>
    </>
  );
}
