import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { getUserAccess, groupByModule, listPermissions } from "@/features/admin/queries";
import { UserOverrideMatrix } from "@/features/admin/components/permission-matrix";

export const metadata: Metadata = { title: "Permissões do usuário" };

export default async function UserAccessPage({ params }: PageProps<"/configuracoes/usuarios/[id]">) {
  await requirePermission("admin.roles");
  const { id } = await params;
  const [access, perms] = await Promise.all([getUserAccess(id), listPermissions()]);
  if (!access) notFound();
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Usuários", href: "/configuracoes/usuarios" }, { label: access.user.full_name || access.user.email }]}
        title={`Permissões de ${access.user.full_name || access.user.email}`}
        description={`Papel: ${access.user.role?.name ?? "sem papel"}. Use exceções só quando esta pessoa precisar de algo diferente do papel.`}
      />
      <PageBody>
        <UserOverrideMatrix userId={id} groups={groupByModule(perms)} roleScopes={access.roleScopes} overrides={access.overrides} />
      </PageBody>
    </>
  );
}
