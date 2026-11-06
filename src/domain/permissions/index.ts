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
  "clients.billing",
  "contracts.read",
  "contracts.create",
  "contracts.update",
  "contracts.delete",
  "contracts.values",
  "tasks.read",
  "tasks.create",
  "tasks.update",
  "tasks.delete",
  "tasks.board.configure",
  "calendar.read",
  "calendar.manage",
  "content.read",
  "content.manage",
  "content.publish",
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

function can(perms: PermissionMap, key: PermissionKey): boolean {
  return perms[key] !== undefined;
}

export function canAny(perms: PermissionMap, keys: readonly PermissionKey[]): boolean {
  return keys.some((k) => can(perms, k));
}

/** Permissões em que o escopo (próprios/equipe/todos) muda o que a pessoa vê. As demais são liga/desliga. */
const SCOPED = /^(crm\.leads\.|crm\.pipeline\.move|clients\.(read|create|update|delete)$|contracts\.(read|create|update|delete)$|tasks\.|calendar\.|dashboards\.commercial|content\.|ads\.|inbox\.(read|reply)$)/;
export function hasScope(key: string): boolean {
  return SCOPED.test(key);
}

const RANK: Record<PermissionScope, number> = { own: 1, team: 2, all: 3 };

export type PermissionOrigin = "papel" | "excecao" | "bloqueio";
export type Override = { effect: "grant" | "deny"; scope: PermissionScope };

/**
 * Permissão efetiva e de onde ela vem. Espelha private.perm_scope no banco:
 * "negar" anula tudo; senão vale o maior escopo entre o papel e a exceção "conceder".
 */
export function effectivePermission(role: PermissionScope | undefined, override: Override | undefined): { scope: PermissionScope | null; origin: PermissionOrigin | null } {
  if (override?.effect === "deny") return { scope: null, origin: "bloqueio" };
  const grant = override?.effect === "grant" ? override.scope : undefined;
  if (grant && (!role || RANK[grant] > RANK[role])) return { scope: grant, origin: "excecao" };
  return role ? { scope: role, origin: "papel" } : { scope: null, origin: null };
}

export function effectivePermissions(roleScopes: Record<string, PermissionScope>, overrides: Record<string, Override>): PermissionMap {
  const map: PermissionMap = {};
  for (const key of PERMISSION_KEYS) {
    const { scope } = effectivePermission(roleScopes[key], overrides[key]);
    if (scope) map[key] = scope;
  }
  return map;
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

