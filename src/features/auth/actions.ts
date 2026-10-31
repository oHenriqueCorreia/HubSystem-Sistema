"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { fail, ok, type ActionResult } from "@/domain/shared/result";
import { newPasswordSchema, resetRequestSchema, safeNext, signInSchema } from "./schemas";

export async function signIn(raw: unknown): Promise<ActionResult<never>> {
  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) return fail("validation", "Revise os campos destacados.");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
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
  const { data: profile } = await supabase.from("profiles").select("is_active").maybeSingle();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return fail("forbidden", "Seu acesso está desativado. Fale com o administrador.");
  }

  redirect(safeNext(parsed.data.next));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

export async function requestPasswordReset(raw: unknown): Promise<ActionResult<null>> {
  const parsed = resetRequestSchema.safeParse(raw);
  if (!parsed.success) return fail("validation", "Informe um e-mail válido.");

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
