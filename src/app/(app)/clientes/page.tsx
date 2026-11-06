import type { Metadata } from "next";
import Link from "next/link";
import { BriefcaseBusiness } from "lucide-react";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState, NoResults } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBRL } from "@/domain/shared/money";
import { formatDate } from "@/domain/shared/dates";
import { formatPhone } from "@/domain/shared/phone";
import { listClients } from "@/features/clients/queries";
import { monthlyValue } from "@/features/clients/types";

export const metadata: Metadata = { title: "Clientes" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" && v ? v : undefined;
}

export default async function ClientesPage({ searchParams }: PageProps<"/clientes">) {
  const user = await requirePermission("clients.read");
  // Valores e documentos só para quem tem a permissão do campo (o banco também não os entrega).
  const canValues = Boolean(user.permissions["contracts.values"]);
  const canBilling = Boolean(user.permissions["clients.billing"]);
  const sp = await searchParams;
  const q = str(sp.q)?.slice(0, 100);
  const clients = await listClients({ q, status: str(sp.status) ?? "ativo" });
  const mrr = clients.reduce((s, c) => s + c.contracts.reduce((x, k) => x + monthlyValue(k), 0), 0);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Comercial" }, { label: "Clientes" }]}
        title="Clientes"
        description={canValues ? `${clients.length} cliente(s) · receita recorrente mensal ${formatBRL(mrr)}` : `${clients.length} cliente(s)`}
      />
      <PageBody className="grid gap-4">
        <form className="flex flex-wrap gap-2" role="search" aria-label="Buscar clientes">
          <Input name="q" type="search" defaultValue={q} placeholder={canBilling ? "Buscar por nome, razão social ou documento…" : "Buscar por nome ou razão social…"} aria-label="Buscar clientes" className="w-full sm:w-80" />
          <select name="status" defaultValue={str(sp.status) ?? "ativo"} aria-label="Situação" className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="ativo">Ativos</option>
            <option value="inativo">Inativos</option>
          </select>
          <Button type="submit" variant="outline">
            Filtrar
          </Button>
        </form>
        {clients.length === 0 ? (
          q ? (
            <NoResults query={q} />
          ) : (
            <EmptyState
              icon={BriefcaseBusiness}
              title="Nenhum cliente ainda"
              description="Clientes surgem ao converter um lead: abra o lead e use “Converter em cliente”, ou feche o negócio no funil."
              action={
                <Button asChild>
                  <Link href="/crm/funil">Abrir o funil</Link>
                </Button>
              }
            />
          )
        ) : (
          <>
            <div className="hidden overflow-x-auto rounded-xl border bg-surface md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Contato</TableHead>
                    <TableHead className="text-right">Contratos ativos</TableHead>
                    {canValues && <TableHead className="text-right">Recorrente/mês</TableHead>}
                    <TableHead>Cliente desde</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link href={`/clientes/${c.id}`} className="font-medium hover:underline">
                          {c.lead?.name}
                        </Link>
                        {c.legal_name && <div className="text-xs text-muted-foreground">{c.legal_name}</div>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatPhone(c.billing_phone_e164 ?? c.lead?.phone_e164) || c.billing_email || "—"}</TableCell>
                      <TableCell className="text-right">{c.contracts.filter((k) => k.status === "ativo").length}</TableCell>
                      {canValues && <TableCell className="text-right">{formatBRL(c.contracts.reduce((x, k) => x + monthlyValue(k), 0))}</TableCell>}
                      <TableCell>{formatDate(c.converted_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="grid gap-2 md:hidden">
              {clients.map((c) => (
                <li key={c.id} className="rounded-lg border bg-surface p-3">
                  <Link href={`/clientes/${c.id}`} className="font-medium">
                    {c.lead?.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {c.contracts.filter((k) => k.status === "ativo").length} contrato(s) ativo(s)
                    {canValues && ` · ${formatBRL(c.contracts.reduce((x, k) => x + monthlyValue(k), 0))}/mês`}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </PageBody>
    </>
  );
}
