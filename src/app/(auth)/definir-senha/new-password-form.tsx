"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { FormAlert, FormField } from "@/components/app/form-field";
import { PasswordInput } from "@/components/app/password-input";
import { updatePassword } from "@/features/auth/actions";
import { newPasswordSchema } from "@/features/auth/schemas";

export function NewPasswordForm({ email }: { email: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<z.input<typeof newPasswordSchema>>({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { password: "", confirm: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    startTransition(async () => {
      const res = await updatePassword(values);
      if (!res.ok) {
        setServerError(res.message);
        return;
      }
      toast.success("Senha salva.");
      router.replace("/inicio");
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {/* Ajuda gerenciadores de senha a associar a conta. */}
      <input type="email" spellCheck={false} name="username" autoComplete="username" value={email} readOnly hidden />
      <FormAlert>{serverError}</FormAlert>
      <FormField label="Nova senha" error={form.formState.errors.password?.message} required>
        <PasswordInput autoComplete="new-password" autoFocus {...form.register("password")} />
      </FormField>
      <FormField label="Confirme a senha" error={form.formState.errors.confirm?.message} required>
        <PasswordInput autoComplete="new-password" {...form.register("confirm")} />
      </FormField>
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
        {pending ? "Salvando…" : "Salvar senha e entrar"}
      </Button>
    </form>
  );
}
