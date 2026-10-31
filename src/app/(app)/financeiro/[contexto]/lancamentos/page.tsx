import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { EmptyState, NoResults } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL } from "@/domain/shared/money";
import { todayLocal } from "@/domain/shared/dates";
import { requireFinance } from "@/features/finance/server";
import { getLookups, listContractsForFinance, listTransactions, type TxnFilters } from "@/features/finance/queries";
import { TxnTable } from "@/features/finance/components/txn-table";
import { ReceivablesDialog } from "@/features/finance/components/receivables-dialog";

export const metadata: Metadata = { title: "Lançamentos" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" && v ? v : undefined;
}

const SITUACOES: [NonNullable<TxnFilters["situacao"]> | "", string][] = [
  ["", "Todos"],
  ["abertos", "Em aberto"],
  ["vencidos", "Vencidos"],
  ["a_receber", "A receber"],
  ["a_pagar", "A pagar"],
  ["pagos", "Pagos"],
  ["nao_conciliados", "Pagos não conciliados"],
];

export default async function LancamentosPage({ params, searchParams }: PageProps<"/financeiro/[contexto]/lancamentos">) {
  const { contexto } = await params;
  const { scope, perms, user } = await requireFinance(contexto);
  const sp = await searchParams;
  const filters: TxnFilters = {
    tipo: str(sp.tipo) as TxnFilters["tipo"],
    situacao: str(sp.situacao) as TxnFilters["situacao"],
    de: str(sp.de),
    ate: str(sp.ate),
    categoria: str(sp.categoria),
    conta: str(sp.conta),
    centro: str(sp.centro),
    q: str(sp.q)?.slice(0, 100),
    data: str(sp.data) as TxnFilters["data"],
    pagina: Number(str(sp.pagina) ?? 1) || 1,
  };
  const today = todayLocal();
  const [result, lookups, contracts] = await Promise.all([
    listTransactions(scope, filters, today),
    getLookups(scope),
    scope === "empresa" && perms.create && user.permissions["contracts.read"] ? listContractsForFinance() : Promise.resolve([]),
  ]);
  const total = result.rows.reduce((s, t) => s + (t.kind === "receita" ? 1 : t.kind === "despesa" ? -1 : 0) * (t.status === "pago" ? (t.paid_amount_cents ?? t.amount_cents) : t.amount_cents), 0);
  const hasFilters = Object.entries(filters).some(([k, v]) => k !== "pagina" && v);

  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) q.set(k, v);
    q.set("pagina", String(p));
    return `/financeiro/${scope}/lancamentos?${q.toString()}`;
  };

  const sel = (name: string, label: string, value: string | undefined, options: [string, string][]) => (
    <div className="grid gap-1">
      <Label htmlFor={`f-${name}`} className="text-xs">
        {label}
      </Label>
      <select id={`f-${name}`} name={name} defaultValue={value ?? ""} className="h-9 rounded-md border bg-background px-2 text-sm">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="grid gap-4">
      <form className="flex flex-wrap items-end gap-3" role="search" aria-label="Filtrar lançamentos">
        <div className="grid gap-1">
          <Label htmlFor="f-q" className="text-xs">
            Descrição
          </Label>
          <Input id="f-q" name="q" type="search" defaultValue={filters.q} className="w-48" />
        </div>
        {sel("situacao", "Situação", filters.situacao, SITUACOES)}
        {sel("tipo", "Tipo", filters.tipo, [["", "Todos"], ["receita", "Receitas"], ["despesa", "Despesas"], ["transferencia", "Transferências"]])}
        {sel("categoria", "Categoria", filters.categoria, [["", "Todas"], ...lookups.categories.map((c) => [c.id, c.name] as [string, string])])}
        {sel("conta", "Conta", filters.conta, [["", "Todas"], ...lookups.accounts.map((a) => [a.id, a.name] as [string, string])])}
        {scope === "empresa" && lookups.costCenters.length > 0 && sel("centro", "Centro de custo", filters.centro, [["", "Todos"], ...lookups.costCenters.map((c) => [c.id, c.name] as [string, string])])}
        {sel("data", "Período por", filters.data, [["", "Vencimento"], ["competencia", "Competência"], ["pagamento", "Pagamento"]])}
        <div className="grid gap-1">
          <Label htmlFor="f-de" className="text-xs">
            De
          </Label>
          <Input id="f-de" name="de" type="date" defaultValue={filters.de} className="w-40" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="f-ate" className="text-xs">
            Até
          </Label>
          <Input id="f-ate" name="ate" type="date" defaultValue={filters.ate} className="w-40" />
        </div>
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
        {hasFilters && (
          <Button asChild variant="ghost">
            <Link href={`/financeiro/${scope}/lancamentos`}>Limpar</Link>
          </Button>
        )}
        {contracts.length > 0 && <ReceivablesDialog contracts={contracts} lookups={lookups} />}
      </form>

      {result.rows.length === 0 ? (
        hasFilters ? <NoResults query={filters.q} /> : <EmptyState icon={Receipt} title="Nenhum lançamento" description="Use “Novo lançamento” para registrar receitas, despesas, parcelas ou contas recorrentes." />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {result.total} lançamento(s) · saldo desta página <span className="tabular font-medium text-foreground">{formatBRL(total)}</span>
          </p>
          <TxnTable scope={scope} rows={result.rows} lookups={lookups} perms={perms} />
          {result.pageCount > 1 && (
            <nav aria-label="Paginação" className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Página {result.page} de {result.pageCount}
              </span>
              <div className="flex gap-2">
                {result.page > 1 && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={href(result.page - 1)}>Anterior</Link>
                  </Button>
                )}
                {result.page < result.pageCount && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={href(result.page + 1)}>Próxima</Link>
                  </Button>
                )}
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
