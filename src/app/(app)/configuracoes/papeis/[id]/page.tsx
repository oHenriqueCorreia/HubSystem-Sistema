import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { getRole, groupByModule, listPermissions } from "@/features/admin/queries";
import { RolePermissionMatrix } from "@/features/admin/components/permission-matrix";
import { DeleteRoleButton } from "@/features/admin/components/delete-role-button";

export const metadata: Metadata = { title: "Papel" };

export default async function RolePage({ params }: PageProps<"/configuracoes/papeis/[id]">) {
  await requirePermission("admin.roles");
  const { id } = await params;
  const [data, perms] = await Promise.all([getRole(id), listPermissions()]);
  if (!data) notFound();
  const locked = data.role.key === "admin";
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Papéis", href: "/configuracoes/papeis" }, { label: data.role.name }]}
        title={data.role.name}
        description={locked ? "O papel Administrador tem acesso total e não pode ser alterado." : "As mudanças valem na hora para todos os usuários deste papel."}
        actions={!data.role.is_system ? <DeleteRoleButton roleId={id} name={data.role.name} /> : null}
      />
      <PageBody>
        <RolePermissionMatrix roleId={id} groups={groupByModule(perms)} scopes={data.scopes} readOnly={locked} />
      </PageBody>
    </>
  );
}
