import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SCOPE_LABEL, hasScope, type PermissionScope } from "@/domain/permissions";
import { getRole, listPermissions } from "@/features/admin/queries";

export const metadata: Metadata = { title: "Comparar papéis" };

const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

export default async function CompareRolesPage({ searchParams }: PageProps<"/configuracoes/papeis/comparar">) {
  await requirePermission("admin.roles");
  const sp = await searchParams;
  if (!isId(sp.a) || !isId(sp.b)) notFound();
  const [a, b, perms] = await Promise.all([getRole(sp.a), getRole(sp.b), listPermissions()]);
  if (!a || !b) notFound();
  const all = sp.tudo === "1";
  const text = (key: string, s: PermissionScope | undefined) => (s ? (hasScope(key) ? SCOPE_LABEL[s] : "Permitido") : "Sem acesso");
  // Compara o que a pessoa enxerga: em permissões liga/desliga o escopo interno não muda nada.
  const differs = (key: string) => text(key, a.scopes[key]) !== text(key, b.scopes[key]);
  const rows = perms.filter((p) => all || differs(p.key));
  const base = `/configuracoes/papeis/comparar?a=${a.role.id}&b=${b.role.id}`;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Papéis", href: "/configuracoes/papeis" }, { label: "Comparar" }]}
        title={`${a.role.name} × ${b.role.name}`}
        description={all ? "Todas as permissões dos dois papéis." : `${rows.length} permissão(ões) diferente(s) entre os dois papéis.`}
      />
      <PageBody className="grid gap-4">
        <p className="text-sm">
          <Link href={all ? base : `${base}&tudo=1`} className="text-primary underline-offset-4 hover:underline">
            {all ? "Mostrar só as diferenças" : "Mostrar todas as permissões"}
          </Link>
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Os dois papéis têm exatamente as mesmas permissões.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Permissão</TableHead>
                  <TableHead>
                    <Link href={`/configuracoes/papeis/${a.role.id}`} className="hover:underline">
                      {a.role.name}
                    </Link>
                  </TableHead>
                  <TableHead>
                    <Link href={`/configuracoes/papeis/${b.role.id}`} className="hover:underline">
                      {b.role.name}
                    </Link>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => {
                  const diff = differs(p.key);
                  return (
                    <TableRow key={p.key}>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">{p.module} · </span>
                        {p.label}
                      </TableCell>
                      <TableCell className={diff ? "font-medium" : undefined}>{text(p.key, a.scopes[p.key])}</TableCell>
                      <TableCell className={diff ? "font-medium" : undefined}>{text(p.key, b.scopes[p.key])}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </PageBody>
    </>
  );
}
