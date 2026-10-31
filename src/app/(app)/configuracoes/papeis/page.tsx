import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { listRoles } from "@/features/admin/queries";
import { CreateRoleDialog } from "@/features/admin/components/forms";

export const metadata: Metadata = { title: "Papéis e permissões" };

export default async function PapeisPage() {
  await requirePermission("admin.roles");
  const roles = await listRoles();
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Configurações" }, { label: "Papéis e permissões" }]}
        title="Papéis e permissões"
        description="Cada usuário tem um papel. Ajuste o que cada papel pode ver e fazer."
        actions={<CreateRoleDialog roles={roles} />}
      />
      <PageBody>
        <ul className="divide-y rounded-xl border bg-surface">
          {roles.map((r) => (
            <li key={r.id}>
              <Link href={`/configuracoes/papeis/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted">
                <span className="grid">
                  <span className="flex items-center gap-2 font-medium">
                    {r.name}
                    {r.is_system && <Badge variant="secondary">Padrão</Badge>}
                  </span>
                  <span className="text-sm text-muted-foreground">{r.description}</span>
                </span>
                <span className="text-sm text-muted-foreground">{r.users} usuário(s)</span>
              </Link>
            </li>
          ))}
        </ul>
      </PageBody>
    </>
  );
}
