import type { Metadata } from "next";
import { requireFinance } from "@/features/finance/server";
import { getLookups, prepareScope } from "@/features/finance/queries";
import { StatementImporter } from "@/features/finance/components/statement-importer";
import type { FinanceScope } from "@/features/finance/types";

export const metadata: Metadata = { title: "Importar extrato" };

export default async function ImportarPage({ params }: { params: Promise<{ contexto: string }> }) {
  const { contexto } = await params;
  const { scope, user, perms } = await requireFinance(contexto);
  // Cada linha pode ir para a empresa ou para o pessoal, conforme o que a pessoa pode acessar.
  const other: FinanceScope = scope === "empresa" ? "pessoal" : "empresa";
  const canOther = other === "pessoal" ? Boolean(user.permissions["finance.personal.manage"]) : Boolean(user.permissions["finance.company.create"]);
  if (canOther) await prepareScope(other);
  const scopes = [...(perms.create ? [scope] : []), ...(canOther ? [other] : [])];
  if (!scopes.length) return <p className="text-sm text-muted-foreground">Você não tem permissão para lançar no financeiro.</p>;
  const entries = await Promise.all(scopes.map(async (s) => [s, await getLookups(s)] as const));
  return <StatementImporter scope={scopes[0]} lookups={Object.fromEntries(entries)} />;
}
