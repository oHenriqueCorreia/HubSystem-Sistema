import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { listRoles, listUsers } from "@/features/admin/queries";
import { InviteUserDialog, UsersTable } from "@/features/admin/components/users-manager";

export const metadata: Metadata = { title: "Usuários" };

export default async function UsuariosPage() {
  const me = await requirePermission("admin.users");
  const [users, roles] = await Promise.all([listUsers(), listRoles()]);
  const active = users.filter((u) => u.is_active).length;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Configurações" }, { label: "Usuários" }]}
        title="Usuários"
        description={`${active} ativo(s) de ${users.length}. O acesso é somente por convite.`}
        actions={<InviteUserDialog roles={roles} />}
      />
      <PageBody>
        <UsersTable users={users} roles={roles} meId={me.id} canEditPermissions={Boolean(me.permissions["admin.roles"])} />
      </PageBody>
    </>
  );
}
