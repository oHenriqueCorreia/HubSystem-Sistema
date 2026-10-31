"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormAlert, FormField } from "@/components/app/form-field";
import { requestPasswordReset } from "@/features/auth/actions";
import { resetRequestSchema } from "@/features/auth/schemas";

export function ResetRequestForm() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const form = useForm<z.input<typeof resetRequestSchema>>({
    resolver: zodResolver(resetRequestSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const res = await requestPasswordReset(values);
      setResult({ ok: res.ok, message: res.ok ? (res.message ?? "") : res.message });
    });
  });

  if (result?.ok) {
    return <FormAlert tone="success">{result.message}</FormAlert>;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {result && !result.ok && <FormAlert>{result.message}</FormAlert>}
      <FormField label="E-mail" error={form.formState.errors.email?.message} required>
        <Input type="email" autoComplete="email" inputMode="email" autoFocus {...form.register("email")} />
      </FormField>
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
        {pending ? "Enviando…" : "Enviar link"}
      </Button>
    </form>
  );
}
