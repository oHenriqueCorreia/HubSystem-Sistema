"use client";

import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "cn";
import { searchLeads } from "../actions";

export type LeadOption = { id: string; name: string; city?: string | null };

/** Seletor de lead com busca no servidor (respeita a RLS de quem busca). */
export function LeadPicker({
  value,
  onChange,
  id,
  ...aria
}: {
  value: LeadOption | null;
  onChange: (v: LeadOption | null) => void;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<LeadOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await searchLeads({ q });
      if (!cancelled) {
        setOptions(res.ok ? res.data : []);
        setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  return (
    <div className="flex gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal" {...aria}>
            <span className={cn("truncate", !value && "text-muted-foreground")}>{value ? value.name : "Sem lead vinculado"}</span>
            <ChevronsUpDown className="opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Buscar lead…" value={q} onValueChange={setQ} />
            <CommandList>
              <CommandEmpty>{loading ? "Buscando…" : "Nenhum lead encontrado."}</CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem
                    key={o.id}
                    value={o.id}
                    onSelect={() => {
                      onChange(o);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn(value?.id === o.id ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                    <span className="truncate">{o.name}</span>
                    {o.city && <span className="ml-auto text-xs text-muted-foreground">{o.city}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <Button type="button" variant="ghost" size="icon" onClick={() => onChange(null)} aria-label="Remover lead vinculado">
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
