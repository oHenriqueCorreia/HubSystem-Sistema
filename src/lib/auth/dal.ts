import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isPermissionKey, type PermissionKey, type PermissionMap, type PermissionScope } from "@/domain/permissions";

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string;
  avatarPath: string | null;
  organizationId: string;
  organizationName: string;
  roles: { key: string; name: string }[];
  permissions: PermissionMap;
  preferences: Record<string, unknown>;
};

/**
 * Usuário da requisição atual (memoizado por requisição).
 * Retorna null se não houver sessão válida ou o perfil estiver inativo.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;

  const [profileRes, permsRes, rolesRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, avatar_path, is_active, organization_id, preferences, organizations(name)")
      .eq("id", userId)
      .maybeSingle(),
    supabase.rpc("my_permissions"),
    supabase.from("user_roles").select("roles(key, name)").eq("user_id", userId),
  ]);

  const profile = profileRes.data;
  if (!profile || !profile.is_active) return null;

  const permissions: PermissionMap = {};
  for (const row of (permsRes.data ?? []) as { permission_key: string; scope: PermissionScope }[]) {
    if (isPermissionKey(row.permission_key)) permissions[row.permission_key] = row.scope;
  }

  const org = profile.organizations as { name: string } | { name: string }[] | null;
  const organizationName = Array.isArray(org) ? (org[0]?.name ?? "") : (org?.name ?? "");

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name || profile.email.split("@")[0],
    avatarPath: profile.avatar_path,
    organizationId: profile.organization_id,
    organizationName,
    roles: (rolesRes.data ?? [])
      .map((r) => {
        const role = r.roles as unknown as { key: string; name: string } | { key: string; name: string }[] | null;
        return Array.isArray(role) ? (role[0] ?? null) : role;
      })
      .filter((r): r is { key: string; name: string } => Boolean(r)),
    permissions,
    preferences: (profile.preferences as Record<string, unknown>) ?? {},
  };
});

/** Exige sessão; senão manda para o login. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Exige uma permissão; usado em páginas (mostra a tela "Sem acesso"). */
export async function requirePermission(key: PermissionKey | PermissionKey[]): Promise<CurrentUser> {
  const user = await requireUser();
  const keys = Array.isArray(key) ? key : [key];
  if (!keys.some((k) => user.permissions[k])) redirect(`/sem-acesso?p=${encodeURIComponent(keys[0])}`);
  return user;
}
