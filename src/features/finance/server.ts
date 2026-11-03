import "server-only";
import { notFound } from "next/navigation";
import { requirePermission, type CurrentUser } from "@/lib/auth/dal";
import { scopeFromParam, type FinanceScope } from "./types";

/** Resolve o contexto da URL e exige a permissão correspondente. */
export async function requireFinance(param: string): Promise<{ scope: FinanceScope; user: CurrentUser; perms: { create: boolean; update: boolean; delete: boolean; reconcile: boolean; transfer: boolean } }> {
  const scope = scopeFromParam(param);
  if (!scope) notFound();
  const user = await requirePermission(scope === "empresa" ? "finance.company.read" : "finance.personal.manage");
  const p = user.permissions;
  // Mover exige poder tirar de uma área e colocar na outra; recorrência também altera o lançamento já movido.
  const transfer = Boolean(p["finance.personal.manage"] && (scope === "empresa" ? p["finance.company.update"] : p["finance.company.create"]));
  const recurring = Boolean(p["finance.personal.manage"] && p["finance.company.create"] && p["finance.company.update"]);
  const perms =
    scope === "pessoal"
      ? { create: true, update: true, delete: true, reconcile: true, transfer, recurring }
      : {
          create: Boolean(p["finance.company.create"]),
          update: Boolean(p["finance.company.update"]),
          delete: Boolean(p["finance.company.delete"]),
          reconcile: Boolean(p["finance.company.reconcile"]),
          transfer,
          recurring: false,
        };
  return { scope, user, perms };
}

/** Primeiro e último dia do mês de uma data civil. */
export function monthBounds(day: string) {
  const [y, m] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${String(m).padStart(2, "0")}-01`, to: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}` };
}

export const MONTH_LABEL = (ym: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${ym}-15T12:00:00Z`)).replace(".", "");
