import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { effectivePermissions } from "@/domain/permissions";
import { getUserAccess, groupByModule, listPermissions, listRoles, listUsers } from "@/features/admin/queries";
import { getAccessHistory, getUserClientLinks } from "@/features/admin/access-queries";
import { listClientOptions, listSquads } from "@/features/squads/queries";
import { UserOverrideMatrix } from "@/features/admin/components/permission-matrix";
import { AccessHistory, ViewAsPreview } from "@/features/admin/components/access-panels";

export const metadata: Metadata = { title: "Permissões do usuário" };

export default async function UserAccessPage({ params }: PageProps<"/configuracoes/usuarios/[id]">) {
  await requirePermission("admin.roles");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [access, perms, history, links, roles, people, clients, squads] = await Promise.all([
    getUserAccess(id),
    listPermissions(),
    getAccessHistory({ userId: id }),
    getUserClientLinks(id),
    listRoles(),
    listUsers(),
    listClientOptions(),
    listSquads(),
  ]);
  if (!access) notFound();
  const name = access.user.full_name || access.user.email;
  const clientNames = new Map(clients.map((c) => [c.id, c.name]));
  const effective = effectivePermissions(access.roleScopes, access.overrides);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Usuários", href: "/configuracoes/usuarios" }, { label: name }]}
        title={`Permissões de ${name}`}
        description={`Papel: ${access.user.role?.name ?? "sem papel"}. Use exceções só quando esta pessoa precisar de algo diferente do papel.`}
      />
      <PageBody className="grid gap-6">
        <ViewAsPreview
          name={name}
          permissions={effective}
          links={links}
          clientName={(cid) => clientNames.get(cid) ?? "cliente fora do seu acesso"}
          clientsScope={effective["clients.read"]}
        />
        <UserOverrideMatrix userId={id} groups={groupByModule(perms)} roleScopes={access.roleScopes} overrides={access.overrides} />
        <AccessHistory
          events={history}
          empty="Nenhuma mudança de acesso registrada para esta pessoa."
          names={{
            permissions: new Map(perms.map((p) => [p.key, p.label])),
            roles: new Map(roles.map((r) => [r.id, r.name])),
            people: new Map(people.map((p) => [p.id, p.full_name || p.email])),
            clients: clientNames,
            squads: new Map(squads.map((s) => [s.id, s.name])),
          }}
        />
      </PageBody>
    </>
  );
}
