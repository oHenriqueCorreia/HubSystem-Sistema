import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { canCreateWorkspaces, listInvitations, listRoles, listUsers } from "@/features/admin/queries";
import { InviteUserDialog, UsersTable } from "@/features/admin/components/users-manager";
import { InvitationsTable } from "@/features/admin/components/invitations-table";

export const metadata: Metadata = { title: "Usuários" };

export default async function UsuariosPage() {
  const me = await requirePermission("admin.users");
  const [allUsers, roles, invitations, workspaces] = await Promise.all([listUsers(), listRoles(), listInvitations(), canCreateWorkspaces()]);
  // Contas criadas por convite ainda não aceito aparecem só na lista de convites.
  const waiting = new Set(invitations.filter((i) => i.state === "pendente" || i.state === "expirado").map((i) => i.email));
  const users = allUsers.filter((u) => u.is_active || !waiting.has(u.email.toLowerCase()));
  const active = users.filter((u) => u.is_active).length;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Configurações" }, { label: "Usuários" }]}
        title="Usuários"
        description={`${active} ativo(s) de ${users.length}. O acesso é somente por convite.`}
        actions={<InviteUserDialog roles={roles} canCreateWorkspaces={workspaces} />}
      />
      <PageBody className="grid gap-6">
        <UsersTable users={users} roles={roles} meId={me.id} canEditPermissions={Boolean(me.permissions["admin.roles"])} />
        <InvitationsTable invitations={invitations} />
      </PageBody>
    </>
  );
}
