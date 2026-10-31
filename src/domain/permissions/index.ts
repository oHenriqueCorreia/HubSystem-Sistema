// Espelho tipado do catálogo em supabase/migrations (tabela public.permissions).
// A autorização de verdade acontece na RLS; isto serve para a interface e para
// checagens antecipadas nas Server Actions.

export const PERMISSION_KEYS = [
  "crm.leads.read",
  "crm.leads.create",
  "crm.leads.update",
  "crm.leads.delete",
  "crm.leads.import",
  "crm.leads.export",
  "crm.leads.assign",
  "crm.pipeline.move",
  "crm.pipeline.configure",
  "crm.cadences.read",
  "crm.cadences.manage",
  "tags.manage",
  "clients.read",
  "clients.create",
  "clients.update",
  "clients.delete",
  "contracts.read",
  "contracts.create",
  "contracts.update",
  "contracts.delete",
  "tasks.read",
  "tasks.create",
  "tasks.update",
  "tasks.delete",
  "tasks.board.configure",
  "calendar.read",
  "calendar.manage",
  "finance.company.read",
  "finance.company.create",
  "finance.company.update",
  "finance.company.delete",
  "finance.company.reconcile",
  "finance.company.reports",
  "finance.personal.manage",
  "finance.personal.admin_read",
  "dashboards.commercial",
  "dashboards.financial",
  "ads.read",
  "ads.manage",
  "inbox.read",
  "inbox.reply",
  "inbox.manage",
  "admin.users",
  "admin.roles",
  "admin.settings",
  "admin.audit",
  "admin.data_export",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type PermissionScope = "own" | "team" | "all";
export type PermissionMap = Partial<Record<PermissionKey, PermissionScope>>;

export const SCOPE_LABEL: Record<PermissionScope, string> = {
  own: "Próprios",
  team: "Da equipe",
  all: "Todos",
};

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

export function can(perms: PermissionMap, key: PermissionKey): boolean {
  return perms[key] !== undefined;
}

export function canAny(perms: PermissionMap, keys: readonly PermissionKey[]): boolean {
  return keys.some((k) => can(perms, k));
}

/** Pode agir sobre um registro de dono `ownerId`? (equipe é resolvida no banco) */
export function canOnRecord(
  perms: PermissionMap,
  key: PermissionKey,
  ownerId: string | null | undefined,
  userId: string,
): boolean {
  const scope = perms[key];
  if (!scope) return false;
  if (scope === "all" || scope === "team") return true;
  return ownerId === userId;
}

export const ROLE_KEYS = ["admin", "gestor", "vendedor", "financeiro", "colaborador", "atendente", "leitura"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];
