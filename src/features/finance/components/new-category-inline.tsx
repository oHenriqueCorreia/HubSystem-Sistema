"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveCategory } from "../actions";
import type { FinanceScope } from "../types";

/** "+ Nova categoria" dentro dos formulários: cria e já seleciona. Também aparece em Contas e categorias. */
export function NewCategoryInline({ scope, kind, onCreated }: { scope: FinanceScope; kind: "receita" | "despesa"; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  if (!open)
    return (
      <Button type="button" variant="link" size="sm" className="h-auto justify-self-start p-0" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" /> Nova categoria de {kind}
      </Button>
    );

  function create() {
    if (name.trim().length < 2) return setError("Use ao menos 2 letras.");
    startTransition(async () => {
      const res = await saveCategory({ scope, name: name.trim(), kind, parentId: null, isActive: true });
      if (!res.ok) return void setError(res.message);
      toast.success(`Categoria “${name.trim()}” criada.`);
      onCreated(res.data.id);
      setName("");
      setError(undefined);
      setOpen(false);
    });
  }

  return (
    <div className="grid gap-1">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              create();
            }
          }}
          maxLength={80}
          autoComplete="off"
          aria-label={`Nome da nova categoria de ${kind}`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `nova-categoria-erro-${kind}` : undefined}
          autoFocus
          placeholder={kind === "despesa" ? "Ex.: Academia…" : "Ex.: Freelas…"}
        />
        <Button type="button" variant="outline" onClick={create} disabled={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Criar
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancelar
        </Button>
      </div>
      {error && (
        <p id={`nova-categoria-erro-${kind}`} className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
