"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { FormAlert, FormField } from "@/components/app/form-field";
import { PasswordInput } from "@/components/app/password-input";
import { useHydrated } from "@/hooks/use-hydrated";
import { createClient } from "@/lib/supabase/client";
import { signIn } from "@/features/auth/actions";
import { safeNext, signInSchema } from "@/features/auth/schemas";
import type { z } from "zod";

type Values = z.input<typeof signInSchema>;

const REASONS: Record<string, string> = {
  sessao: "Sua sessão terminou. Entre novamente.",
  desativado: "Seu acesso está desativado. Fale com o administrador.",
  senha: "Senha salva. Entre com a nova senha.",
};

// E-mail lembrado neste aparelho (só quando a pessoa escolhe manter conectado).
const LAST_EMAIL = "hub:ultimo-email";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
    </svg>
  );
}

export function LoginForm({ next, reason, google = false }: { next?: string; reason?: string; google?: boolean }) {
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const [googlePending, setGooglePending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "", next, remember: true },
  });
  const remember = useWatch({ control: form.control, name: "remember" }) ?? true;

  // Preenche o e-mail usado da última vez neste aparelho.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAST_EMAIL);
      if (saved && !form.getValues("email")) form.setValue("email", saved);
    } catch {
      /* armazenamento indisponível */
    }
  }, [form]);

  function rememberEmail(email: string, keep: boolean) {
    try {
      if (keep) localStorage.setItem(LAST_EMAIL, email.trim().toLowerCase());
      else localStorage.removeItem(LAST_EMAIL);
    } catch {
      /* armazenamento indisponível */
    }
  }

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    rememberEmail(values.email, values.remember ?? true);
    startTransition(async () => {
      const res = await signIn(values);
      // Em caso de sucesso a action redireciona e não retorna.
      if (res && !res.ok) {
        setServerError(res.message);
        form.setFocus(res.code === "unauthenticated" ? "password" : "email");
      }
    });
  });

  async function signInWithGoogle() {
    setServerError(null);
    setGooglePending(true);
    const back = new URL("/auth/confirm", window.location.origin);
    back.searchParams.set("next", safeNext(next));
    back.searchParams.set("lembrar", remember ? "1" : "0");
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: back.toString(), queryParams: { prompt: "select_account" } },
    });
    if (error) {
      setGooglePending(false);
      setServerError("Não foi possível abrir o login do Google. Tente de novo ou entre com e-mail e senha.");
    }
  }

  const { errors } = form.formState;

  return (
    <div className="grid gap-5">
      {reason && REASONS[reason] && !serverError && <FormAlert tone={reason === "senha" ? "success" : "info"}>{REASONS[reason]}</FormAlert>}
      <FormAlert>{serverError}</FormAlert>

      {google && (
        <>
          <Button type="button" variant="outline" size="lg" className="w-full gap-3" onClick={signInWithGoogle} disabled={googlePending || pending}>
            {googlePending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <GoogleIcon />}
            {googlePending ? "Abrindo o Google…" : "Entrar com Google"}
          </Button>
          <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            ou com e-mail e senha
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      {/* method="post" e botão travado até carregar: um envio antes do JavaScript não põe a senha na URL. */}
      <form method="post" onSubmit={onSubmit} noValidate className="grid gap-5" aria-label="Entrar com e-mail e senha">
        <FormField label="E-mail" error={errors.email?.message} required>
          <Input type="email" spellCheck={false} autoComplete="username email" inputMode="email" autoFocus className="h-11" {...form.register("email")} />
        </FormField>

        <FormField label="Senha" error={errors.password?.message} required>
          <PasswordInput autoComplete="current-password" className="h-11" {...form.register("password")} />
        </FormField>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={remember} onCheckedChange={(v) => form.setValue("remember", Boolean(v))} />
            Manter conectado neste aparelho
          </label>
          <Link href="/recuperar-senha" className="text-sm text-primary underline-offset-4 hover:underline">
            Esqueci minha senha
          </Link>
        </div>

        <Button type="submit" size="lg" disabled={pending || googlePending || !hydrated} className="w-full">
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {pending ? "Entrando…" : "Entrar"}
        </Button>
        <p className="text-xs leading-5 text-muted-foreground">
          {remember
            ? "Você continua conectado até sair. Seu navegador pode oferecer para salvar a senha."
            : "A sessão termina quando você fechar o navegador. Use em computadores compartilhados."}
        </p>
      </form>
    </div>
  );
}
