"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormAlert, FormField } from "@/components/app/form-field";
import { PasswordInput } from "@/components/app/password-input";
import { signIn } from "@/features/auth/actions";
import { signInSchema } from "@/features/auth/schemas";
import type { z } from "zod";

type Values = z.input<typeof signInSchema>;

const REASONS: Record<string, string> = {
  sessao: "Sua sessão terminou. Entre novamente.",
  desativado: "Seu acesso está desativado. Fale com o administrador.",
  senha: "Senha salva. Entre com a nova senha.",
};

export function LoginForm({ next, reason }: { next?: string; reason?: string }) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "", next },
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    startTransition(async () => {
      const res = await signIn(values);
      // Em caso de sucesso a action redireciona e não retorna.
      if (res && !res.ok) {
        setServerError(res.message);
        form.setFocus(res.code === "unauthenticated" ? "password" : "email");
      }
    });
  });

  const { errors } = form.formState;

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {reason && REASONS[reason] && !serverError && (
        <FormAlert tone={reason === "senha" ? "success" : "info"}>{REASONS[reason]}</FormAlert>
      )}
      <FormAlert>{serverError}</FormAlert>

      <FormField label="E-mail" error={errors.email?.message} required>
        <Input type="email" spellCheck={false} autoComplete="email" inputMode="email" autoFocus {...form.register("email")} />
      </FormField>

      <FormField label="Senha" error={errors.password?.message} required>
        <PasswordInput autoComplete="current-password" {...form.register("password")} />
      </FormField>

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
        {pending ? "Entrando…" : "Entrar"}
      </Button>

      <Link href="/recuperar-senha" className="justify-self-start text-sm text-primary underline-offset-4 hover:underline">
        Esqueci minha senha
      </Link>
    </form>
  );
}
