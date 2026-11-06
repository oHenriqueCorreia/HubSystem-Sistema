"use server";

import { revalidatePath } from "next/cache";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { fail, ok } from "@/domain/shared/result";
import { normalizePhone } from "@/domain/shared/phone";
import {
  createRoleSchema,
  orgSettingsSchema,
  overrideSchema,
  profileSchema,
  rolePermissionSchema,
  setActiveSchema,
  setRoleSchema,
} from "./schemas";

function hasSecretKey() {
  return Boolean(process.env.SUPABASE_SECRET_KEY);
}

const SECRET_MISSING =
  "Convites ainda não estão configurados no servidor (falta SUPABASE_SECRET_KEY). Avise o responsável técnico.";

/** Gera um link de acesso para o admin copiar (quando o e-mail não chega). */
export const generateAccessLink = defineAction(
  { schema: setActiveSchema.pick({ userId: true }), permission: "admin.users" },
  async ({ userId }) => {
    if (!hasSecretKey()) return fail("business_rule", SECRET_MISSING);
    const supabase = await createClient();
    const profile = must(await supabase.from("profiles").select("email").eq("id", userId).single());

    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email: profile.email });
    if (error || !data.properties?.hashed_token) return fail("unknown", "Não foi possível gerar o link.");

    const link = `${publicEnv.NEXT_PUBLIC_SITE_URL}/auth/confirm?token_hash=${data.properties.hashed_token}&type=recovery&next=/definir-senha`;
    return ok({ link }, "Link gerado. Ele vale por 1 hora e só pode ser usado uma vez.");
  },
);

export const setUserActive = defineAction({ schema: setActiveSchema, permission: "admin.users" }, async (input) => {
  const supabase = await createClient();
  must(await supabase.rpc("admin_set_user_active", { p_user: input.userId, p_active: input.active }));

  // Encerra as sessões abertas de quem foi desativado (e libera ao reativar).
  if (hasSecretKey()) {
    const admin = createAdminClient();
    await admin.auth.admin.updateUserById(input.userId, { ban_duration: input.active ? "none" : "876000h" });
  }

  revalidatePath("/configuracoes/usuarios");
  return ok(null, input.active ? "Usuário reativado." : "Usuário desativado.");
});

export const setUserRole = defineAction({ schema: setRoleSchema, permission: "admin.users" }, async (input) => {
  const supabase = await createClient();
  must(await supabase.rpc("admin_set_user_role", { p_user: input.userId, p_role: input.roleId }));
  revalidatePath("/configuracoes/usuarios");
  return ok(null, "Papel atualizado.");
});

export const setPermissionOverride = defineAction({ schema: overrideSchema, permission: "admin.roles" }, async (input) => {
  const supabase = await createClient();
  if (input.effect === null) {
    must(
      await supabase
        .from("user_permission_overrides")
        .delete()
        .eq("user_id", input.userId)
        .eq("permission_key", input.permissionKey),
    );
  } else {
    must(
      await supabase.from("user_permission_overrides").upsert({
        user_id: input.userId,
        permission_key: input.permissionKey,
        effect: input.effect,
        scope: input.scope,
      }),
    );
  }
  revalidatePath(`/configuracoes/usuarios/${input.userId}`);
  return ok(null, "Permissão atualizada.");
});

export const setRolePermission = defineAction({ schema: rolePermissionSchema, permission: "admin.roles" }, async (input) => {
  const supabase = await createClient();
  if (input.scope === null) {
    must(
      await supabase.from("role_permissions").delete().eq("role_id", input.roleId).eq("permission_key", input.permissionKey),
    );
  } else {
    must(
      await supabase
        .from("role_permissions")
        .upsert({ role_id: input.roleId, permission_key: input.permissionKey, scope: input.scope }),
    );
  }
  revalidatePath(`/configuracoes/papeis/${input.roleId}`);
  return ok(null, "Permissão do papel atualizada.");
});

export const createRole = defineAction({ schema: createRoleSchema, permission: "admin.roles" }, async (input) => {
  const supabase = await createClient();
  if (input.template) {
    const id = must(await supabase.rpc("admin_create_role_from_template", { p_template: input.template, p_name: input.name, p_description: input.description || null }));
    revalidatePath("/configuracoes/papeis");
    return ok({ id }, "Papel criado a partir do modelo.");
  }
  const id = must(
    await supabase.rpc("admin_create_role", {
      p_name: input.name,
      p_description: input.description,
      p_copy_from: input.copyFrom ?? undefined,
    }),
  );
  revalidatePath("/configuracoes/papeis");
  return ok({ id }, "Papel criado.");
});

export const deleteRole = defineAction({ schema: setRoleSchema.pick({ roleId: true }), permission: "admin.roles" }, async ({ roleId }) => {
  const supabase = await createClient();
  const { count } = await supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role_id", roleId);
  if (count && count > 0) {
    return fail("business_rule", "Há usuários com este papel. Mude o papel deles antes de excluir.");
  }
  const res = must(await supabase.from("roles").delete().eq("id", roleId).select("id"));
  if (!res.length) return fail("forbidden", "Este papel não pode ser excluído.");
  revalidatePath("/configuracoes/papeis");
  return ok(null, "Papel excluído.");
});

export const updateOrganization = defineAction({ schema: orgSettingsSchema, permission: "admin.settings" }, async (input, { user }) => {
  const supabase = await createClient();
  const current = must(await supabase.from("organizations").select("settings").eq("id", user.organizationId).single());
  const settings = { ...(current.settings as Record<string, unknown>), whatsapp_default_message: input.whatsappMessage };
  must(await supabase.from("organizations").update({ name: input.name, settings }).eq("id", user.organizationId));
  revalidatePath("/", "layout");
  return ok(null, "Configurações salvas.");
});

export const updateMyProfile = defineAction({ schema: profileSchema }, async (input, { user }) => {
  let phone: string | null = null;
  if (input.phone) {
    const n = normalizePhone(input.phone);
    if (!n) return fail("validation", "Telefone inválido.", { phone: ["Informe um telefone válido com DDD."] });
    phone = n.e164;
  }
  const supabase = await createClient();
  must(
    await supabase
      .from("profiles")
      .update({ full_name: input.fullName, job_title: input.jobTitle || null, phone_e164: phone })
      .eq("id", user.id),
  );
  revalidatePath("/", "layout");
  return ok(null, "Perfil salvo.");
});
