"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { clientIp, RATE_LIMIT_MESSAGE, withinRateLimit } from "@/lib/rate-limit";
import { fail, ok, type ActionResult } from "@/domain/shared/result";
import { formatDateTime } from "@/domain/shared/dates";
import { acceptInvitationSchema, invitationIdSchema, inviteSchema } from "./schemas";

const INVITE_DAYS = 7;
const SECRET_MISSING =
  "Convites ainda não estão configurados no servidor (falta SUPABASE_SECRET_KEY). Avise o responsável técnico.";

const newToken = () => randomBytes(32).toString("base64url");
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const acceptUrl = (token: string) => `${publicEnv.NEXT_PUBLIC_SITE_URL}/convite/${token}`;

type InvitationRow = {
  id: string;
  organization_id: string;
  email: string;
  full_name: string;
  mode: "equipe" | "ambiente";
  workspace_name: string | null;
  role_id: string | null;
  status: "pendente" | "aceito" | "cancelado";
  expires_at: string;
  user_id: string | null;
};

/**
 * Cria a conta (perfil inativo) e dispara o e-mail do Supabase. Os campos em
 * `data` alimentam o template personalizado (supabase/templates/convite.html).
 */
async function sendInvite(inv: InvitationRow, token: string, ctx: { inviterName: string; organizationName: string; roleKey: string | null; roleName: string }) {
  const admin = createAdminClient();
  const data: Record<string, string> = {
    invitation_id: inv.id,
    full_name: inv.full_name,
    invite_url: acceptUrl(token),
    inviter_name: ctx.inviterName,
    organization_name: inv.mode === "ambiente" ? (inv.workspace_name ?? "") : ctx.organizationName,
    role_name: ctx.roleName,
    expires_label: formatDateTime(inv.expires_at),
  };
  if (inv.mode === "equipe") {
    data.organization_id = inv.organization_id;
    if (ctx.roleKey) data.role_key = ctx.roleKey;
  } else {
    data.workspace_name = inv.workspace_name ?? "";
  }
  return admin.auth.admin.inviteUserByEmail(inv.email, { data, redirectTo: acceptUrl(token) });
}

/** Remove a conta criada pelo convite, apenas se ela nunca foi ativada. */
async function removePendingAccount(userId: string | null) {
  if (!userId) return;
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("is_active, organization_id").eq("id", userId).maybeSingle();
  if (!profile || profile.is_active) return;
  await admin.auth.admin.deleteUser(userId);
  // Convite de ambiente: a organização criada para a pessoa fica vazia; remove.
  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("organization_id", profile.organization_id);
  if (count === 0) await admin.from("organizations").delete().eq("id", profile.organization_id);
}

async function inviteContext(roleId: string | null, inviterId: string) {
  const supabase = await createClient();
  const [role, me] = await Promise.all([
    roleId ? supabase.from("roles").select("key, name").eq("id", roleId).single() : Promise.resolve({ data: null, error: null }),
    supabase.from("profiles").select("full_name, email, organizations(name)").eq("id", inviterId).single(),
  ]);
  if (role.error) throw role.error;
  const org = me.data?.organizations as { name: string } | { name: string }[] | null | undefined;
  return {
    roleKey: role.data?.key ?? null,
    roleName: role.data?.name ?? "Administrador",
    inviterName: me.data?.full_name || me.data?.email || "Hub System",
    organizationName: (Array.isArray(org) ? org[0]?.name : org?.name) ?? "Hub System",
  };
}

export const inviteUser = defineAction({ schema: inviteSchema, permission: "admin.users" }, async (input, { user }) => {
  if (!process.env.SUPABASE_SECRET_KEY) return fail("business_rule", SECRET_MISSING);
  if (!(await withinRateLimit(`invite:${user.id}`, 30, 3600))) return fail("business_rule", RATE_LIMIT_MESSAGE);

  const email = input.email.toLowerCase();
  const supabase = await createClient();
  if (input.mode === "ambiente") {
    const { data: allowed } = await supabase.rpc("can_create_workspaces");
    if (!allowed) return fail("forbidden", "Sua conta não pode criar empresas novas por convite. Convide a pessoa para a sua equipe.");
  }
  const { data: member } = await supabase.from("profiles").select("id, is_active").eq("email", email).maybeSingle();
  if (member?.is_active) return fail("conflict", "Esta pessoa já faz parte da sua organização.");
  const { data: pending } = await supabase.from("invitations").select("id").eq("email", email).eq("status", "pendente").maybeSingle();
  if (pending) return fail("conflict", "Já existe um convite pendente para este e-mail. Use “Reenviar”.");

  // Confirma (pela RLS) que o papel é desta organização.
  const ctx = await inviteContext(input.mode === "equipe" ? input.roleId : null, user.id);

  const token = newToken();
  const admin = createAdminClient();
  const inv = must(
    await admin
      .from("invitations")
      .insert({
        organization_id: user.organizationId,
        email,
        full_name: input.fullName,
        mode: input.mode,
        workspace_name: input.mode === "ambiente" ? input.workspaceName : null,
        role_id: input.mode === "equipe" ? input.roleId : null,
        permission_overrides: input.mode === "equipe" ? input.overrides : [],
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString(),
        invited_by: user.id,
      })
      .select("*")
      .single(),
  ) as InvitationRow;

  const { data, error } = await sendInvite(inv, token, ctx);
  if (error || !data.user) {
    await admin.from("invitations").delete().eq("id", inv.id);
    if (error?.code === "email_exists" || /already been registered/i.test(error?.message ?? "")) {
      return fail("conflict", "Este e-mail já tem uma conta no Hub System em outra organização.");
    }
    if (error?.status === 429) return fail("business_rule", "Limite de e-mails do servidor atingido. Tente novamente em alguns minutos.");
    console.error("[inviteUser]", error?.code ?? error?.status);
    return fail("unknown", "Não foi possível enviar o convite agora.");
  }
  await admin.from("invitations").update({ user_id: data.user.id }).eq("id", inv.id);

  revalidatePath("/configuracoes/usuarios");
  return ok(null, `Convite enviado para ${email}.`);
});

export const resendInvitation = defineAction({ schema: invitationIdSchema, permission: "admin.users" }, async ({ id }, { user }) => {
  if (!process.env.SUPABASE_SECRET_KEY) return fail("business_rule", SECRET_MISSING);
  if (!(await withinRateLimit(`invite:${user.id}`, 30, 3600))) return fail("business_rule", RATE_LIMIT_MESSAGE);

  const supabase = await createClient();
  const inv = must(await supabase.from("invitations").select("*").eq("id", id).single()) as InvitationRow & { send_count: number };
  if (inv.status !== "pendente") return fail("business_rule", "Só convites pendentes podem ser reenviados.");

  // Novo token e novo prazo; a conta pendente anterior é recriada com o e-mail novo.
  await removePendingAccount(inv.user_id);
  const token = newToken();
  const admin = createAdminClient();
  const updated = must(
    await admin
      .from("invitations")
      .update({
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString(),
        send_count: inv.send_count + 1,
        last_sent_at: new Date().toISOString(),
        user_id: null,
      })
      .eq("id", id)
      .select("*")
      .single(),
  ) as InvitationRow;

  const { data, error } = await sendInvite(updated, token, await inviteContext(updated.role_id, user.id));
  if (error || !data.user) {
    console.error("[resendInvitation]", error?.code ?? error?.status);
    return fail("unknown", "Não foi possível reenviar o convite agora.");
  }
  await admin.from("invitations").update({ user_id: data.user.id }).eq("id", id);
  revalidatePath("/configuracoes/usuarios");
  return ok(null, `Convite reenviado para ${updated.email}.`);
});

export const cancelInvitation = defineAction({ schema: invitationIdSchema, permission: "admin.users" }, async ({ id }, { user }) => {
  if (!process.env.SUPABASE_SECRET_KEY) return fail("business_rule", SECRET_MISSING);
  const supabase = await createClient();
  const inv = must(await supabase.from("invitations").select("*").eq("id", id).single()) as InvitationRow;
  if (inv.status !== "pendente") return fail("business_rule", "Este convite não está mais pendente.");

  const admin = createAdminClient();
  must(
    await admin
      .from("invitations")
      .update({ status: "cancelado", cancelled_at: new Date().toISOString(), cancelled_by: user.id })
      .eq("id", id)
      .eq("status", "pendente"),
  );
  await removePendingAccount(inv.user_id);
  revalidatePath("/configuracoes/usuarios");
  return ok(null, "Convite cancelado. O link deixou de funcionar.");
});

// --- Aceite (página pública /convite/[token]) -----------------------------------

export type InvitationPreview =
  | { state: "valido"; email: string; fullName: string; organizationName: string; inviterName: string; roleName: string; mode: "equipe" | "ambiente"; expiresAt: string }
  | { state: "expirado" | "usado" | "cancelado" | "invalido" };

export async function previewInvitation(token: string): Promise<InvitationPreview> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token) || !process.env.SUPABASE_SECRET_KEY) return { state: "invalido" };
  const admin = createAdminClient();
  const { data } = await admin
    .from("invitations")
    .select("email, full_name, mode, workspace_name, status, expires_at, user_id, organizations(name), roles(name), inviter:profiles!invitations_invited_by_fkey(full_name, email)")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!data || !data.user_id) return { state: "invalido" };
  if (data.status === "aceito") return { state: "usado" };
  if (data.status === "cancelado") return { state: "cancelado" };
  if (new Date(data.expires_at).getTime() < Date.now()) return { state: "expirado" };
  const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const org = one(data.organizations as { name: string } | { name: string }[] | null);
  const role = one(data.roles as { name: string } | { name: string }[] | null);
  const inviter = one(data.inviter as { full_name: string; email: string } | { full_name: string; email: string }[] | null);
  return {
    state: "valido",
    email: data.email,
    fullName: data.full_name,
    mode: data.mode,
    organizationName: data.mode === "ambiente" ? (data.workspace_name ?? "") : (org?.name ?? ""),
    roleName: data.mode === "ambiente" ? "Administrador" : (role?.name ?? ""),
    inviterName: inviter?.full_name || inviter?.email || "",
    expiresAt: data.expires_at,
  };
}

export async function acceptInvitation(raw: unknown): Promise<ActionResult<null>> {
  const parsed = acceptInvitationSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fieldErrors[i.path.join(".")] ??= []).push(i.message);
    return fail("validation", "Revise os campos destacados.", fieldErrors);
  }
  if (!process.env.SUPABASE_SECRET_KEY) return fail("business_rule", SECRET_MISSING);
  if (!(await withinRateLimit(`accept:${await clientIp()}`, 10, 900))) return fail("business_rule", RATE_LIMIT_MESSAGE);

  const admin = createAdminClient();
  const { data: inv } = await admin
    .from("invitations")
    .select("id, email, status, expires_at, user_id")
    .eq("token_hash", hashToken(parsed.data.token))
    .maybeSingle();
  if (!inv || !inv.user_id || inv.status !== "pendente" || new Date(inv.expires_at).getTime() < Date.now()) {
    return fail("business_rule", "Este convite é inválido, já foi usado ou expirou. Peça um novo convite.");
  }

  const { error: updErr } = await admin.auth.admin.updateUserById(inv.user_id, {
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.fullName },
  });
  if (updErr) {
    if (updErr.code === "weak_password") return fail("validation", "Senha fraca. Use letras e números, com 8 ou mais caracteres.");
    console.error("[acceptInvitation]", updErr.code ?? updErr.status);
    return fail("unknown", "Não foi possível concluir o cadastro. Tente novamente.");
  }
  const { error: finErr } = await admin.rpc("finalize_invitation", { p_invitation: inv.id, p_full_name: parsed.data.fullName });
  if (finErr) return fail("business_rule", "Este convite é inválido, já foi usado ou expirou. Peça um novo convite.");

  const supabase = await createClient();
  const { error: signErr } = await supabase.auth.signInWithPassword({ email: inv.email, password: parsed.data.password });
  if (signErr) redirect("/login");
  redirect("/inicio");
}
