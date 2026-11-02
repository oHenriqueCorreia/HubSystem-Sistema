"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Tags } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { createCategoriesFromTags } from "../actions";
import type { Category, FinanceScope } from "../types";

/** Transforma etiquetas do sistema em tipos de despesa ou de receita. */
export function TagsToCategories({ scope, tags, categories }: { scope: FinanceScope; tags: { id: string; name: string }[]; categories: Category[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<"despesa" | "receita">("despesa");
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const taken = new Set(categories.filter((c) => c.kind === kind).map((c) => c.name.toLowerCase()));
  const usable = tags.filter((t) => t.name.trim().length >= 2);

  if (!usable.length) return null;

  function create() {
    startTransition(async () => {
      const res = await createCategoriesFromTags({ scope, kind, names: usable.filter((t) => picked.includes(t.id)).map((t) => t.name) });
      if (!res.ok) return void toast.error(res.message);
      toast.success(res.message);
      setPicked([]);
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="etiquetas" className="grid gap-3 rounded-xl border bg-surface p-4">
      <div className="grid gap-1">
        <h2 id="etiquetas" className="flex items-center gap-2 text-sm font-semibold">
          <Tags className="size-4 text-muted-foreground" aria-hidden="true" /> Criar tipos a partir das etiquetas
        </h2>
        <p className="text-sm text-muted-foreground">Escolha etiquetas que você já usa no sistema para virarem tipos de {kind === "despesa" ? "despesa" : "receita"}.</p>
      </div>
      <ToggleGroup type="single" variant="outline" value={kind} onValueChange={(v) => v && (setKind(v as typeof kind), setPicked([]))} aria-label="Criar como" className="justify-self-start">
        <ToggleGroupItem value="despesa">Tipos de despesa</ToggleGroupItem>
        <ToggleGroupItem value="receita">Tipos de receita</ToggleGroupItem>
      </ToggleGroup>
      <ul className="flex flex-wrap gap-2">
        {usable.map((t) => {
          const exists = taken.has(t.name.toLowerCase());
          return (
            <li key={t.id}>
              <label className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm has-[:disabled]:opacity-60">
                <Checkbox checked={picked.includes(t.id)} disabled={exists} onCheckedChange={(v) => setPicked((p) => (v ? [...p, t.id] : p.filter((x) => x !== t.id)))} />
                {t.name}
                {exists && <span className="text-xs text-muted-foreground">(já existe)</span>}
              </label>
            </li>
          );
        })}
      </ul>
      <Button className="justify-self-start" disabled={pending || !picked.length} onClick={create}>
        {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Criar {picked.length || ""} tipo{picked.length === 1 ? "" : "s"}
      </Button>
    </section>
  );
}
