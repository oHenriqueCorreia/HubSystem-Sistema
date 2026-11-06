import "server-only";
import { createClient } from "@/lib/supabase/server";

export type AccessEvent = {
  id: number;
  action: string;
  entity_type: string;
  changes: Record<string, unknown>;
  created_at: string;
  actor_id: string | null;
};

// Tabelas que definem o acesso de uma pessoa ou de um papel (a auditoria guarda o id em entity_id).
const USER_TABLES = ["user_roles", "user_permission_overrides", "client_members", "team_members", "profiles"];
const ROLE_TABLES = ["roles", "role_permissions"];

/** Últimas mudanças de acesso de uma pessoa ou de um papel. */
export async function getAccessHistory(target: { userId: string } | { roleId: string }, limit = 40): Promise<AccessEvent[]> {
  const supabase = await createClient();
  const [tables, id] = "userId" in target ? [USER_TABLES, target.userId] : [ROLE_TABLES, target.roleId];
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, action, entity_type, changes, created_at, actor_id")
    .in("entity_type", tables)
    .eq("entity_id", id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AccessEvent[];
}

export type UserClientLinks = {
  direct: { client_id: string; role_label: string }[];
  squads: { id: string; name: string; clientIds: string[] }[];
};

/** Clientes em que a pessoa trabalha: associação direta e pelos squads. */
export async function getUserClientLinks(userId: string): Promise<UserClientLinks> {
  const supabase = await createClient();
  const [direct, squads] = await Promise.all([
    supabase.from("client_members").select("client_id, role_label").eq("user_id", userId),
    supabase.from("team_members").select("team:teams(id, name, team_clients(client_id))").eq("user_id", userId),
  ]);
  if (direct.error) throw direct.error;
  if (squads.error) throw squads.error;
  type Team = { id: string; name: string; team_clients: { client_id: string }[] | null };
  return {
    direct: (direct.data ?? []) as UserClientLinks["direct"],
    squads: (squads.data ?? [])
      .map((m) => (Array.isArray(m.team) ? m.team[0] : m.team) as Team | null)
      .filter((t): t is Team => Boolean(t))
      .map((t) => ({ id: t.id, name: t.name, clientIds: (t.team_clients ?? []).map((c) => c.client_id) })),
  };
}
