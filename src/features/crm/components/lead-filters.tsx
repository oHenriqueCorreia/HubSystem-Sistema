"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { LoaderCircle, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CrmLookups } from "../types";

const KEYS = ["q", "etapa", "responsavel", "segmento", "etiqueta", "status", "contato", "ordem"] as const;
const STORAGE_KEY = "hub:crm-filtros";
const ALL = "__todos__";

/**
 * Filtros do CRM. O estado vive na URL (compartilhável) e é lembrado no
 * navegador para a próxima visita.
 */
export function LeadFilters({ lookups, pipelineId, show = "all" }: { lookups: CrmLookups; pipelineId?: string; show?: "all" | "board" }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const restored = useRef(false);

  // Restaura os filtros salvos quando a URL chega sem nenhum.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const hasAny = KEYS.some((k) => params.get(k));
    if (hasAny) return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(JSON.parse(saved) as Record<string, string>)) {
        if (KEYS.includes(k as (typeof KEYS)[number]) && v && !(show === "board" && (k === "etapa" || k === "ordem" || k === "status" || k === "contato"))) next.set(k, v);
      }
      if (next.toString() !== params.toString()) router.replace(`${pathname}?${next.toString()}`);
    } catch {
      /* armazenamento indisponível */
    }
  }, [params, pathname, router, show]);

  function update(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value && value !== ALL) next.set(key, value);
    else next.delete(key);
    next.delete("pagina");
    try {
      const toSave: Record<string, string> = {};
      for (const k of KEYS) {
        const v = next.get(k);
        if (v && k !== "q") toSave[k] = v;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch {
      /* ignore */
    }
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  // Busca com espera curta para não consultar a cada tecla.
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (q === current) return;
    const t = setTimeout(() => update("q", q.trim() || null), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const stages = lookups.pipelines.find((p) => p.id === pipelineId)?.stages ?? lookups.pipelines[0]?.stages ?? [];
  const active = KEYS.filter((k) => k !== "q" && params.get(k)).length + (params.get("q") ? 1 : 0);

  function clearAll() {
    setQ("");
    const next = new URLSearchParams();
    const pipeline = params.get("funil");
    const view = params.get("modo");
    if (pipeline) next.set("funil", pipeline);
    if (view) next.set("modo", view);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  }

  const sel = (key: string, label: string, options: { value: string; label: string }[], width = "w-40") => (
    <Select value={params.get(key) ?? ALL} onValueChange={(v) => update(key, v)}>
      <SelectTrigger className={width} aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: todos</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div role="search" aria-label="Filtrar leads" className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar nome, cidade, telefone…"
          aria-label="Buscar leads"
          className="pl-8"
        />
      </div>
      {show === "all" && sel("etapa", "Etapa", stages.map((s) => ({ value: s.id, label: s.name })), "w-44")}
      {sel("responsavel", "Responsável", [{ value: "sem", label: "Sem responsável" }, ...lookups.owners.map((o) => ({ value: o.id, label: o.full_name || o.email }))])}
      {lookups.segments.length > 0 && sel("segmento", "Segmento", lookups.segments.map((s) => ({ value: s.id, label: s.name })))}
      {lookups.tags.length > 0 && sel("etiqueta", "Etiqueta", lookups.tags.map((t) => ({ value: t.id, label: t.name })), "w-36")}
      {show === "all" &&
        sel("contato", "Próximo contato", [
          { value: "atrasado", label: "Atrasados" },
          { value: "hoje", label: "Para hoje" },
          { value: "sem", label: "Sem agendamento" },
        ], "w-44")}
      {show === "all" &&
        sel("status", "Situação", [
          { value: "ativo", label: "Ativos" },
          { value: "cliente", label: "Clientes" },
          { value: "descartado", label: "Descartados" },
        ], "w-36")}
      {show === "all" &&
        sel("ordem", "Ordenar", [
          { value: "recentes", label: "Mais recentes" },
          { value: "nome", label: "Nome (A–Z)" },
          { value: "proximo", label: "Próximo contato" },
          { value: "ultimo", label: "Último contato" },
        ], "w-40")}
      {active > 0 && (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          <X aria-hidden="true" /> Limpar filtros ({active})
        </Button>
      )}
      {pending && <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-label="Atualizando" />}
    </div>
  );
}
