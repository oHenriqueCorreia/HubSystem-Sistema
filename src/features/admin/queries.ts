import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { PermissionScope } from "@/domain/permissions";

export type PermissionDef = { key: string; module: string; label: string; position: number };
export type RoleRow = { id: string; key: string; name: string; description: string; is_system: boolean };
export type UserRow = {
  id: string;
  email: string;
  full_name: string;
  job_title: string | null;
  is_active: boolean;
  last_seen_at: string | null;
  created_at: string;
  role: RoleRow | null;
};

export async function listPermissions(): Promise<PermissionDef[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("permissions").select("key, module, label, position").order("position");
  if (error) throw error;
  return data ?? [];
}

export function groupByModule(perms: PermissionDef[]) {
  const map = new Map<string, PermissionDef[]>();
  for (const p of perms) map.set(p.module, [...(map.get(p.module) ?? []), p]);
  return [...map.entries()];
}

export async function listRoles(): Promise<(RoleRow & { users: number })[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("roles").select("id, key, name, description, is_system, user_roles(count)").order("is_system", { ascending: false }).order("name");
  if (error) throw error;
  return (data ?? []).map((r) => {
    const count = (r.user_roles as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
    return { id: r.id, key: r.key, name: r.name, description: r.description, is_system: r.is_system, users: count };
  });
}

export type RoleTemplate = { key: string; name: string; description: string };

/** Modelos de papel por função (catálogo global, ver migration role_templates). */
export async function listRoleTemplates(): Promise<RoleTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("role_templates").select("key, name, description").order("position");
  if (error) throw error;
  return (data ?? []) as RoleTemplate[];
}

export async function getRole(id: string) {
  const supabase = await createClient();
  const [role, perms] = await Promise.all([
    supabase.from("roles").select("id, key, name, description, is_system").eq("id", id).maybeSingle(),
    supabase.from("role_permissions").select("permission_key, scope").eq("role_id", id),
  ]);
  if (role.error) throw role.error;
  if (!role.data) return null;
  return {
    role: role.data as RoleRow,
    scopes: Object.fromEntries((perms.data ?? []).map((p) => [p.permission_key, p.scope as PermissionScope])) as Record<string, PermissionScope>,
  };
}

export async function listUsers(): Promise<UserRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, job_title, is_active, last_seen_at, created_at, user_roles(roles(id, key, name, description, is_system))")
    .order("is_active", { ascending: false })
    .order("full_name");
  if (error) throw error;
  return (data ?? []).map((u) => {
    const ur = (u.user_roles as unknown as { roles: RoleRow | RoleRow[] | null }[] | null) ?? [];
    const first = ur[0]?.roles;
    const role = Array.isArray(first) ? (first[0] ?? null) : (first ?? null);
    return { ...(u as unknown as UserRow), role };
  });
}

export async function getUserAccess(userId: string) {
  const supabase = await createClient();
  const [users, overrides] = await Promise.all([
    listUsers(),
    supabase.from("user_permission_overrides").select("permission_key, effect, scope").eq("user_id", userId),
  ]);
  const user = users.find((u) => u.id === userId) ?? null;
  if (!user) return null;
  let roleScopes: Record<string, PermissionScope> = {};
  if (user.role) {
    const r = await getRole(user.role.id);
    roleScopes = r?.scopes ?? {};
  }
  return {
    user,
    roleScopes,
    overrides: Object.fromEntries(
      (overrides.data ?? []).map((o) => [o.permission_key, { effect: o.effect as "grant" | "deny", scope: o.scope as PermissionScope }]),
    ) as Record<string, { effect: "grant" | "deny"; scope: PermissionScope }>,
  };
}

export type AuditRow = {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  changes: Record<string, unknown>;
  created_at: string;
  actor_id: string | null;
};

export async function listAudit(opts: { entity?: string; actor?: string; from?: string; to?: string; page: number }) {
  const supabase = await createClient();
  const size = 50;
  let q = supabase
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, changes, created_at, actor_id", { count: "exact" })
    .order("created_at", { ascending: false });
  if (opts.entity) q = q.eq("entity_type", opts.entity);
  if (opts.actor) q = q.eq("actor_id", opts.actor);
  if (opts.from) q = q.gte("created_at", `${opts.from}T00:00:00-03:00`);
  if (opts.to) q = q.lte("created_at", `${opts.to}T23:59:59-03:00`);
  const from = (opts.page - 1) * size;
  const { data, error, count } = await q.range(from, from + size - 1);
  if (error) throw error;
  return { rows: (data ?? []) as AuditRow[], total: count ?? 0, pageCount: Math.max(1, Math.ceil((count ?? 0) / size)) };
}

export async function getOrganization() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("organizations").select("id, name, settings").maybeSingle();
  if (error) throw error;
  return data as { id: string; name: string; settings: Record<string, unknown> } | null;
}

export async function getMyProfile(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("full_name, email, job_title, phone_e164").eq("id", userId).single();
  if (error) throw error;
  return data as { full_name: string; email: string; job_title: string | null; phone_e164: string | null };
}

export type InvitationState = "pendente" | "aceito" | "expirado" | "cancelado";
export type InvitationListRow = {
  id: string;
  email: string;
  full_name: string;
  mode: "equipe" | "ambiente";
  workspace_name: string | null;
  role_name: string | null;
  state: InvitationState;
  expires_at: string;
  last_sent_at: string;
  send_count: number;
  accepted_at: string | null;
};

/** A conta atual pode convidar para "ambiente próprio" (empresa nova)? Na dúvida, não. */
/** Memoizado por requisição: o layout e páginas como o Prospectador perguntam na mesma renderização. */
export const canCreateWorkspaces = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("can_create_workspaces");
  return data === true;
});

/** Convites da organização. "Expirado" é derivado do prazo, nunca gravado. */
export async function listInvitations(): Promise<InvitationListRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invitations")
    .select("id, email, full_name, mode, workspace_name, status, expires_at, last_sent_at, send_count, accepted_at, roles(name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const now = Date.now();
  return (data ?? []).map((r) => {
    const role = r.roles as unknown as { name: string } | { name: string }[] | null;
    return {
      id: r.id,
      email: r.email,
      full_name: r.full_name,
      mode: r.mode,
      workspace_name: r.workspace_name,
      role_name: (Array.isArray(role) ? role[0]?.name : role?.name) ?? null,
      state: r.status === "pendente" && new Date(r.expires_at).getTime() < now ? "expirado" : r.status,
      expires_at: r.expires_at,
      last_sent_at: r.last_sent_at,
      send_count: r.send_count,
      accepted_at: r.accepted_at,
    };
  });
}
