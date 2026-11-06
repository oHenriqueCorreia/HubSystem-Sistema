import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Squad = { id: string; name: string; description: string; leader_id: string | null; memberIds: string[]; clientIds: string[] };
export type PersonOption = { id: string; name: string };
export type ClientOption = { id: string; name: string };
export type ClientTeam = {
  members: { user_id: string; name: string; role_label: string }[];
  squads: { id: string; name: string }[];
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function listSquads(): Promise<Squad[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("teams").select("id, name, description, leader_id, team_members(user_id), team_clients(client_id)").order("name");
  if (error) throw error;
  return (data ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    description: (t.description as string) ?? "",
    leader_id: (t.leader_id as string | null) ?? null,
    memberIds: ((t.team_members as { user_id: string }[] | null) ?? []).map((m) => m.user_id),
    clientIds: ((t.team_clients as { client_id: string }[] | null) ?? []).map((c) => c.client_id),
  }));
}

/** Pessoas ativas da empresa (para escolher membros e líderes). */
export async function listPeople(): Promise<PersonOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("id, full_name, email").eq("is_active", true).order("full_name");
  if (error) throw error;
  return (data ?? []).map((p) => ({ id: p.id as string, name: (p.full_name as string) || (p.email as string) }));
}

/** Clientes que a pessoa enxerga (a RLS filtra). */
export async function listClientOptions(): Promise<ClientOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("clients").select("id, legal_name, lead:leads(name)").is("deleted_at", null);
  if (error) throw error;
  return (data ?? [])
    .map((c) => ({ id: c.id as string, name: one(c.lead as { name: string } | { name: string }[] | null)?.name || (c.legal_name as string | null) || "Cliente sem nome" }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export async function getClientTeam(clientId: string): Promise<ClientTeam> {
  const supabase = await createClient();
  const [members, squads] = await Promise.all([
    supabase.from("client_members").select("user_id, role_label, profile:profiles(full_name, email)").eq("client_id", clientId),
    supabase.from("team_clients").select("team:teams(id, name)").eq("client_id", clientId),
  ]);
  if (members.error) throw members.error;
  if (squads.error) throw squads.error;
  return {
    members: (members.data ?? [])
      .map((m) => {
        const p = one(m.profile as { full_name: string; email: string } | { full_name: string; email: string }[] | null);
        return { user_id: m.user_id as string, role_label: (m.role_label as string) ?? "", name: p?.full_name || p?.email || "Pessoa" };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    squads: (squads.data ?? []).map((s) => one(s.team as { id: string; name: string } | { id: string; name: string }[] | null)).filter((s): s is { id: string; name: string } => Boolean(s)),
  };
}
