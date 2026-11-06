"use server";

import { revalidatePath } from "next/cache";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { fail, ok } from "@/domain/shared/result";
import { clientMemberSchema, removeClientMemberSchema, squadIdSchema, squadSchema } from "./schemas";

// Quem trabalha em cada cliente define o que a pessoa enxerga (ver a migration
// client_scope_squads). Só admin.users mexe nisso; o banco impede que alguém
// que não é administrador associe a si mesmo ou ligue clientes ao próprio squad.

function refresh(clientIds: string[] = []) {
  revalidatePath("/configuracoes/squads");
  for (const id of clientIds) revalidatePath(`/clientes/${id}`);
}

/** Troca o conjunto de linhas (team_members/team_clients) pelo informado, removendo e incluindo só a diferença. */
async function syncLinks(table: "team_members" | "team_clients", column: "user_id" | "client_id", teamId: string, wanted: string[], organizationId: string) {
  const supabase = await createClient();
  const current = (must(await supabase.from(table).select(column).eq("team_id", teamId)) as Record<string, string>[]).map((r) => r[column]);
  const remove = current.filter((id) => !wanted.includes(id));
  const add = wanted.filter((id) => !current.includes(id));
  if (remove.length) must(await supabase.from(table).delete().eq("team_id", teamId).in(column, remove));
  if (add.length) {
    const rows = add.map((id) => (table === "team_clients" ? { team_id: teamId, client_id: id, organization_id: organizationId } : { team_id: teamId, user_id: id }));
    must(await supabase.from(table).insert(rows));
  }
  return [...remove, ...add];
}

export const saveSquad = defineAction({ schema: squadSchema, permission: "admin.users" }, async (input, { user }) => {
  const supabase = await createClient();
  // O líder faz parte do squad.
  const memberIds = input.leaderId && !input.memberIds.includes(input.leaderId) ? [...input.memberIds, input.leaderId] : input.memberIds;
  const row = { name: input.name, description: input.description, leader_id: input.leaderId };

  let id = input.id;
  const { data, error } = id
    ? await supabase.from("teams").update(row).eq("id", id).select("id").maybeSingle()
    : await supabase.from("teams").insert({ ...row, organization_id: user.organizationId }).select("id").single();
  if (error?.code === "23505") return fail("conflict", "Já existe um squad com esse nome.");
  if (error) throw error;
  if (!data) return fail("not_found", "Squad não encontrado.");
  id = data.id as string;

  await syncLinks("team_members", "user_id", id, memberIds, user.organizationId);
  const changedClients = await syncLinks("team_clients", "client_id", id, input.clientIds, user.organizationId);
  refresh(changedClients);
  return ok({ id }, input.id ? "Squad salvo." : "Squad criado.");
});

export const deleteSquad = defineAction({ schema: squadIdSchema, permission: "admin.users" }, async ({ id }) => {
  const supabase = await createClient();
  const clients = (must(await supabase.from("team_clients").select("client_id").eq("team_id", id)) as { client_id: string }[]).map((c) => c.client_id);
  // Os vínculos saem em cascata (e vão para a auditoria); quem estava no squad deixa de ver os clientes dele.
  must(await supabase.from("teams").delete().eq("id", id));
  refresh(clients);
  return ok(null, "Squad excluído.");
});

export const addClientMember = defineAction({ schema: clientMemberSchema, permission: "admin.users" }, async (input) => {
  const supabase = await createClient();
  must(await supabase.from("client_members").upsert({ client_id: input.clientId, user_id: input.userId, role_label: input.roleLabel }, { onConflict: "client_id,user_id" }));
  refresh([input.clientId]);
  return ok(null, "Pessoa associada ao cliente.");
});

export const removeClientMember = defineAction({ schema: removeClientMemberSchema, permission: "admin.users" }, async (input) => {
  const supabase = await createClient();
  must(await supabase.from("client_members").delete().eq("client_id", input.clientId).eq("user_id", input.userId));
  refresh([input.clientId]);
  return ok(null, "Pessoa removida do cliente.");
});
