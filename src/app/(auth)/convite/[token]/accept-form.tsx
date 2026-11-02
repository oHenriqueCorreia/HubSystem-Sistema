"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormAlert, FormField } from "@/components/app/form-field";
import { PasswordInput } from "@/components/app/password-input";
import { useHydrated } from "@/hooks/use-hydrated";
import { acceptInvitation } from "@/features/admin/invitations";
import { acceptInvitationSchema } from "@/features/admin/schemas";

export function AcceptInvitationForm({ token, email, defaultName }: { token: string; email: string; defaultName: string }) {
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<z.input<typeof acceptInvitationSchema>>({
    resolver: zodResolver(acceptInvitationSchema),
    defaultValues: { token, fullName: defaultName, password: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    startTransition(async () => {
      // Em caso de sucesso a action redireciona para o início.
      const res = await acceptInvitation(values);
      if (res && !res.ok) setServerError(res.message);
    });
  });

  return (
    // method="post" e botão travado até carregar: um envio antes do JavaScript não põe a senha na URL.
    <form method="post" onSubmit={onSubmit} noValidate className="grid gap-4">
      <FormAlert>{serverError}</FormAlert>
      <FormField label="E-mail">
        <Input type="email" name="username" autoComplete="username" value={email} readOnly />
      </FormField>
      <FormField label="Seu nome" error={form.formState.errors.fullName?.message} required>
        <Input autoComplete="name" autoFocus defaultValue={defaultName} {...form.register("fullName")} />
      </FormField>
      <FormField label="Crie uma senha" hint="Pelo menos 8 caracteres, com letras e números." error={form.formState.errors.password?.message} required>
        <PasswordInput autoComplete="new-password" {...form.register("password")} />
      </FormField>
      <Button type="submit" size="lg" disabled={pending || !hydrated} className="w-full">
        {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
        {pending ? "Ativando acesso…" : "Aceitar convite e entrar"}
      </Button>
      <p className="text-xs leading-5 text-muted-foreground">
        Este link é pessoal e funciona uma única vez. Se você não esperava este convite, apenas ignore.
      </p>
    </form>
  );
}
