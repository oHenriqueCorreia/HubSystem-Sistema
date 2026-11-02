"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { clientIp, RATE_LIMIT_MESSAGE, withinRateLimit } from "@/lib/rate-limit";
import { applyRememberChoice, clearRememberChoice } from "@/lib/auth/remember";
import { fail, ok, type ActionResult } from "@/domain/shared/result";
import { newPasswordSchema, resetRequestSchema, safeNext, signInSchema } from "./schemas";

export async function signIn(raw: unknown): Promise<ActionResult<never>> {
  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) return fail("validation", "Revise os campos destacados.");

  const ip = await clientIp();
  const allowed =
    (await withinRateLimit(`login:ip:${ip}`, 20, 600)) && (await withinRateLimit(`login:email:${parsed.data.email.toLowerCase()}`, 8, 600));
  if (!allowed) return fail("business_rule", RATE_LIMIT_MESSAGE);

  const supabase = await createClient();
  const { data: auth, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    if (error.code === "invalid_credentials") return fail("unauthenticated", "E-mail ou senha incorretos.");
    if (error.code === "user_banned") {
      return fail("forbidden", "Seu acesso está desativado. Fale com o administrador.");
    }
    if (error.status === 429) return fail("business_rule", "Muitas tentativas. Aguarde alguns minutos e tente de novo.");
    return fail("unknown", "Não foi possível entrar agora. Tente novamente.");
  }

  // Perfil desativado no HubSystem também bloqueia (além do bloqueio no Auth).
  const { data: profile } = await supabase.from("profiles").select("is_active").eq("id", auth.user.id).maybeSingle();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return fail("forbidden", "Seu acesso está desativado. Fale com o administrador.");
  }
  await supabase.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", auth.user.id);
  await applyRememberChoice(parsed.data.remember);

  redirect(safeNext(parsed.data.next));
}

/**
 * Fim do login com Google: a sessão já foi aberta no navegador. Confere se a
 * pessoa tem acesso (perfil ativo) e aplica a escolha de manter conectado.
 */
export async function completeOAuthSignIn(remember: boolean): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return fail("unauthenticated", "Não foi possível entrar com o Google. Tente de novo.");
  const { data: profile } = await supabase.from("profiles").select("is_active").eq("id", data.user.id).maybeSingle();
  if (!profile?.is_active) {
    await supabase.auth.signOut({ scope: "local" });
    return fail("forbidden", profile ? "Seu acesso ainda não foi liberado. Abra o link do convite que chegou no seu e-mail ou fale com o administrador." : "Esta conta Google não tem acesso. Entre com o e-mail em que você recebeu o convite.");
  }
  await supabase.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", data.user.id);
  await applyRememberChoice(remember);
  return ok(null);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  await clearRememberChoice();
  redirect("/login");
}

export async function requestPasswordReset(raw: unknown): Promise<ActionResult<null>> {
  const parsed = resetRequestSchema.safeParse(raw);
  if (!parsed.success) return fail("validation", "Informe um e-mail válido.");

  if (!(await withinRateLimit(`reset:ip:${await clientIp()}`, 5, 900))) return fail("business_rule", RATE_LIMIT_MESSAGE);

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv.NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/definir-senha`,
  });

  if (error?.status === 429) {
    return fail("business_rule", "Muitos pedidos seguidos. Aguarde um minuto e tente de novo.");
  }
  // Mesma resposta exista ou não a conta, para não revelar quem tem cadastro.
  return ok(null, "Se houver uma conta com esse e-mail, enviamos um link para criar uma nova senha.");
}

export async function updatePassword(raw: unknown): Promise<ActionResult<null>> {
  const parsed = newPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fieldErrors[i.path.join(".")] ??= []).push(i.message);
    return fail("validation", "Revise os campos destacados.", fieldErrors);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return fail("validation", "Escolha uma senha diferente da atual.");
    if (error.code === "weak_password") return fail("validation", "Senha fraca. Use letras e números, com 8 ou mais caracteres.");
    if (error.code === "reauthentication_needed" || error.status === 401) {
      return fail("unauthenticated", "O link expirou. Peça um novo link de recuperação.");
    }
    return fail("unknown", "Não foi possível salvar a senha. Tente novamente.");
  }
  return ok(null, "Senha salva.");
}
