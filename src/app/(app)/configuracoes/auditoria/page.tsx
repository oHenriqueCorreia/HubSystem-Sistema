import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/domain/shared/dates";
import { listAudit, listUsers } from "@/features/admin/queries";

export const metadata: Metadata = { title: "Auditoria" };

const ENTITY: Record<string, string> = {
  profiles: "Usuário",
  user_roles: "Papel do usuário",
  user_permission_overrides: "Exceção de permissão",
  role_permissions: "Permissão do papel",
  roles: "Papel",
  organizations: "Empresa",
  leads: "Lead",
  deals: "Negócio",
  imports: "Importação",
  clients: "Cliente",
  contracts: "Contrato",
  financial_transactions: "Lançamento financeiro",
  tasks: "Tarefa",
  calendar_events: "Evento",
};

const ACTION: Record<string, string> = {
  insert: "Criou",
  update: "Alterou",
  delete: "Excluiu",
  soft_delete: "Moveu para a lixeira",
  restore: "Restaurou",
  undo_import: "Desfez importação",
  convert_lead: "Converteu em cliente",
  admin_read_personal_finance: "Consultou financeiro pessoal",
};

function describe(changes: Record<string, unknown>, action: string) {
  if (action !== "update" && action !== "soft_delete" && action !== "restore") return null;
  return Object.entries(changes)
    .map(([k, v]) => {
      const c = v as { de?: unknown; para?: unknown; alterado?: boolean };
      if (c?.alterado) return `${k}: alterado`;
      const fmt = (x: unknown) => (x === null || x === undefined ? "vazio" : typeof x === "object" ? JSON.stringify(x) : String(x));
      return `${k}: ${fmt(c?.de)} → ${fmt(c?.para)}`;
    })
    .join("; ");
}

function str(v: string | string[] | undefined) {
  return typeof v === "string" && v ? v : undefined;
}

export default async function AuditoriaPage({ searchParams }: PageProps<"/configuracoes/auditoria">) {
  await requirePermission("admin.audit");
  const sp = await searchParams;
  const page = Number(str(sp.pagina) ?? 1) || 1;
  const filters = { entity: str(sp.area), actor: str(sp.usuario), from: str(sp.de), to: str(sp.ate) };
  const [result, users] = await Promise.all([listAudit({ ...filters, page }), listUsers()]);
  const names = new Map(users.map((u) => [u.id, u.full_name || u.email]));

  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) q.set(k, v);
    q.set("pagina", String(p));
    return `/configuracoes/auditoria?${q.toString()}`;
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Configurações" }, { label: "Auditoria" }]}
        title="Auditoria"
        description="Registro permanente das ações sensíveis. Ninguém pode editar ou apagar estes registros."
      />
      <PageBody className="grid gap-4">
        <form className="flex flex-wrap items-end gap-3" role="search" aria-label="Filtrar auditoria">
          <div className="grid gap-1">
            <Label htmlFor="area">Área</Label>
            <select id="area" name="area" defaultValue={filters.entity ?? ""} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="">Todas</option>
              {Object.entries(ENTITY).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="usuario">Quem fez</Label>
            <select id="usuario" name="usuario" defaultValue={filters.actor ?? ""} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="">Todos</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name || u.email}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="de">De</Label>
            <Input id="de" name="de" type="date" defaultValue={filters.from} className="w-40" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ate">Até</Label>
            <Input id="ate" name="ate" type="date" defaultValue={filters.to} className="w-40" />
          </div>
          <Button type="submit" variant="outline">
            Filtrar
          </Button>
        </form>

        {result.rows.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Nenhum registro" description="Ações sensíveis, como mudanças de permissão, exclusões e alterações financeiras, aparecem aqui." />
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Quem</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Detalhes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(r.created_at)}</TableCell>
                    <TableCell>{r.actor_id ? (names.get(r.actor_id) ?? "Usuário removido") : "Sistema"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {ACTION[r.action] ?? r.action} · {ENTITY[r.entity_type] ?? r.entity_type}
                    </TableCell>
                    <TableCell className="max-w-xl text-xs break-words text-muted-foreground">{describe(r.changes, r.action)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {result.pageCount > 1 && (
          <nav aria-label="Paginação" className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Página {page} de {result.pageCount}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Button asChild variant="outline" size="sm">
                  <Link href={href(page - 1)}>Anterior</Link>
                </Button>
              )}
              {page < result.pageCount && (
                <Button asChild variant="outline" size="sm">
                  <Link href={href(page + 1)}>Próxima</Link>
                </Button>
              )}
            </div>
          </nav>
        )}
      </PageBody>
    </>
  );
}
