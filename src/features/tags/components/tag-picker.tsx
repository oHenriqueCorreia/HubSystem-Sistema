"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { Plus, Search, Tags } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TAG_COLOR_LABEL, TagChip } from "@/features/crm/components/chips";
import type { Tag, TagColor } from "@/features/crm/types";
import { createTag } from "../actions";
import { TAG_COLORS } from "../schemas";

/**
 * Seletor de etiquetas controlado: mostra as escolhidas e abre uma lista com
 * busca, marcação múltipla e criação de etiqueta nova (com cor) na hora.
 */
export function TagPicker({
  value,
  onChange,
  options,
  canCreate = true,
  disabled,
  triggerLabel = "Etiquetas",
  className,
}: {
  value: string[];
  onChange: (ids: string[], created?: Tag) => void;
  options: Tag[];
  canCreate?: boolean;
  disabled?: boolean;
  triggerLabel?: string;
  className?: string;
}) {
  const inputId = useId();
  const [extra, setExtra] = useState<Tag[]>([]);
  const [query, setQuery] = useState("");
  const [newColor, setNewColor] = useState<TagColor>("teal");
  const [pending, startTransition] = useTransition();
  const all = useMemo(() => {
    const map = new Map([...options, ...extra].map((t) => [t.id, t]));
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [options, extra]);
  const selected = new Set(value);
  const q = query.trim().toLocaleLowerCase("pt-BR");
  const visible = q ? all.filter((t) => t.name.toLocaleLowerCase("pt-BR").includes(q)) : all;
  const exact = all.some((t) => t.name.toLocaleLowerCase("pt-BR") === q);

  function toggle(id: string, on: boolean) {
    onChange(on ? [...value, id] : value.filter((v) => v !== id));
  }

  function create() {
    const name = query.trim();
    if (!name) return;
    startTransition(async () => {
      const res = await createTag({ name, color: newColor });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const tag = res.data as Tag;
      setExtra((e) => [...e, tag]);
      setQuery("");
      onChange([...value, tag.id], tag);
    });
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {all
        .filter((t) => selected.has(t.id))
        .map((t) => (
          <TagChip key={t.id} name={t.name} color={t.color} />
        ))}
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" size="xs" variant="outline" disabled={disabled}>
            <Tags aria-hidden="true" /> {value.length ? "Editar" : triggerLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="grid w-72 gap-3" align="start">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Label htmlFor={inputId} className="sr-only">
              Buscar ou criar etiqueta
            </Label>
            <Input
              id={inputId}
              value={query}
              maxLength={40}
              placeholder={canCreate ? "Buscar ou criar…" : "Buscar…"}
              className="pl-8"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (canCreate && q && !exact) create();
                }
              }}
            />
          </div>
          <fieldset className="grid max-h-56 gap-1 overflow-y-auto overscroll-contain">
            <legend className="sr-only">Etiquetas disponíveis</legend>
            {visible.length === 0 && <p className="px-1 text-sm text-muted-foreground">{q ? "Nenhuma etiqueta com esse nome." : "Nenhuma etiqueta ainda."}</p>}
            {visible.map((t) => (
              <label key={t.id} className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-1 text-sm hover:bg-accent">
                <Checkbox checked={selected.has(t.id)} disabled={disabled} onCheckedChange={(v) => toggle(t.id, Boolean(v))} />
                <TagChip name={t.name} color={t.color} />
              </label>
            ))}
          </fieldset>
          {canCreate && q && !exact && (
            <div className="grid gap-2 border-t pt-3">
              <div role="radiogroup" aria-label="Cor da nova etiqueta" className="flex flex-wrap gap-1">
                {TAG_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={newColor === c}
                    aria-label={TAG_COLOR_LABEL[c]}
                    onClick={() => setNewColor(c)}
                    className={cn("rounded p-0.5", newColor === c && "ring-2 ring-ring")}
                  >
                    <TagChip name="Aa" color={c} />
                  </button>
                ))}
              </div>
              <Button type="button" size="sm" onClick={create} disabled={pending}>
                <Plus aria-hidden="true" /> Criar “{query.trim()}”
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
