import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { getRole, groupByModule, listPermissions, listRoles, listUsers } from "@/features/admin/queries";
import { getAccessHistory } from "@/features/admin/access-queries";
import { RolePermissionMatrix } from "@/features/admin/components/permission-matrix";
import { DeleteRoleButton } from "@/features/admin/components/delete-role-button";
import { AccessHistory } from "@/features/admin/components/access-panels";

export const metadata: Metadata = { title: "Papel" };

export default async function RolePage({ params }: PageProps<"/configuracoes/papeis/[id]">) {
  await requirePermission("admin.roles");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [data, perms, roles, history, people] = await Promise.all([getRole(id), listPermissions(), listRoles(), getAccessHistory({ roleId: id }), listUsers()]);
  if (!data) notFound();
  const locked = data.role.key === "admin";
  const others = roles.filter((r) => r.id !== id);
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Papéis", href: "/configuracoes/papeis" }, { label: data.role.name }]}
        title={data.role.name}
        description={locked ? "O papel Administrador tem acesso total e não pode ser alterado." : "As mudanças valem na hora para todos os usuários deste papel."}
        actions={!data.role.is_system ? <DeleteRoleButton roleId={id} name={data.role.name} /> : null}
      />
      <PageBody className="grid gap-6">
        {others.length > 0 && (
          <form action="/configuracoes/papeis/comparar" method="get" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="a" value={id} />
            <div className="grid gap-1.5">
              <label htmlFor="comparar-com" className="text-sm font-medium">
                Comparar com
              </label>
              <select id="comparar-com" name="b" defaultValue={others[0].id} className="h-11 min-w-48 rounded-md border bg-background px-2 text-sm sm:h-9">
                {others.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="outline">
              Comparar papéis
            </Button>
          </form>
        )}
        <p className="text-sm text-muted-foreground">
          “Próprios” e “Da equipe” também incluem os clientes em que a pessoa trabalha (Equipe do cliente ou squad). Valores de contrato e dados de cobrança têm permissões próprias.
        </p>
        <RolePermissionMatrix roleId={id} groups={groupByModule(perms)} scopes={data.scopes} readOnly={locked} />
        <AccessHistory
          events={history}
          empty="Nenhuma mudança registrada neste papel."
          names={{
            permissions: new Map(perms.map((p) => [p.key, p.label])),
            roles: new Map(roles.map((r) => [r.id, r.name])),
            people: new Map(people.map((p) => [p.id, p.full_name || p.email])),
            clients: new Map(),
            squads: new Map(),
          }}
        />
      </PageBody>
    </>
  );
}
