"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormAlert, FormField } from "@/components/app/form-field";
import { decideContent } from "../actions";

export function ReviewForm({ token }: { token: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(decision: "aprovado" | "ajustes") {
    setError(null);
    if (decision === "ajustes" && !comment.trim()) return setError("Conte o que precisa ser ajustado.");
    startTransition(async () => {
      const res = await decideContent({ token, decision, comment, name });
      if (!res.ok) return setError(res.message);
      setDone(res.message ?? "Decisão registrada.");
      router.refresh();
    });
  }

  if (done) {
    return (
      <p role="status" className="rounded-lg border border-success/40 bg-success-soft p-3 text-sm">
        {done}
      </p>
    );
  }

  return (
    <form
      className="grid gap-3 rounded-xl border bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        decide("aprovado");
      }}
    >
      <FormAlert>{error}</FormAlert>
      <FormField label="Seu nome" required>
        <Input name="name" value={name} maxLength={120} autoComplete="name" onChange={(e) => setName(e.target.value)} />
      </FormField>
      <FormField label="Comentário" optional hint="Obrigatório para pedir ajustes.">
        <Textarea rows={3} value={comment} maxLength={4000} onChange={(e) => setComment(e.target.value)} />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || name.trim().length < 2}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Aprovar conteúdo
        </Button>
        <Button type="button" variant="outline" disabled={pending || name.trim().length < 2} onClick={() => decide("ajustes")}>
          Solicitar ajustes
        </Button>
      </div>
    </form>
  );
}
