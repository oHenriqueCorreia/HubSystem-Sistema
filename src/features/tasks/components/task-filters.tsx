"use client";

import { MobileFilters } from "@/components/app/mobile-filters";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { LoaderCircle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "cn";

const ALL = "__todos__";
const STORAGE = "hub:tarefas-filtros";

export function TaskFilters({
  owners,
  canSeeOthers,
  tags = [],
}: {
  owners: { id: string; full_name: string; email: string }[];
  canSeeOthers: boolean;
  tags?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const mode = params.get("modo") ?? "lista";

  function update(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value && value !== ALL) next.set(key, value);
    else next.delete(key);
    try {
      const keep: Record<string, string> = {};
      for (const k of ["responsavel", "status", "prioridade", "periodo", "modo", "etiqueta"]) {
        const v = next.get(k);
        if (v) keep[k] = v;
      }
      localStorage.setItem(STORAGE, JSON.stringify(keep));
    } catch {
      /* ignore */
    }
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  useEffect(() => {
    if (params.toString()) return;
    try {
      const saved = localStorage.getItem(STORAGE);
      if (saved) router.replace(`${pathname}?${new URLSearchParams(JSON.parse(saved) as Record<string, string>).toString()}`);
    } catch {
      /* ignore */
    }
  }, [params, pathname, router]);

  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const t = setTimeout(() => update("q", q.trim() || null), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const modeHref = (m: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("modo", m);
    return `${pathname}?${next.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Modo de visualização" className="inline-flex rounded-lg border bg-surface p-0.5">
        {[
          ["lista", "Lista"],
          ["quadro", "Quadro"],
        ].map(([m, label]) => (
          <Link
            key={m}
            href={modeHref(m)}
            aria-current={mode === m ? "page" : undefined}
            className={cn("rounded-md px-3 py-1.5 text-sm font-medium", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {label}
          </Link>
        ))}
        <Link href="/agenda?tipo=tarefa" className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          Calendário
        </Link>
      </nav>
      <div className="relative w-full sm:w-56">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tarefas…" aria-label="Buscar tarefas" className="pl-8" />
      </div>
      <MobileFilters active={["responsavel", "periodo", "prioridade", "etiqueta", "status"].filter((k) => params.get(k)).length}>
      {canSeeOthers && (
        <Select value={params.get("responsavel") ?? ALL} onValueChange={(v) => update("responsavel", v)}>
          <SelectTrigger className="w-44" aria-label="Responsável">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os responsáveis</SelectItem>
            <SelectItem value="eu">Só as minhas</SelectItem>
            {owners.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.full_name || o.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select value={params.get("periodo") ?? ALL} onValueChange={(v) => update("periodo", v)}>
        <SelectTrigger className="w-40" aria-label="Prazo">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Qualquer prazo</SelectItem>
          <SelectItem value="atrasadas">Atrasadas</SelectItem>
          <SelectItem value="hoje">Hoje</SelectItem>
          <SelectItem value="semana">Até 7 dias</SelectItem>
          <SelectItem value="sem_prazo">Sem prazo</SelectItem>
        </SelectContent>
      </Select>
      <Select value={params.get("prioridade") ?? ALL} onValueChange={(v) => update("prioridade", v)}>
        <SelectTrigger className="w-40" aria-label="Prioridade">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Qualquer prioridade</SelectItem>
          <SelectItem value="urgente">Urgente</SelectItem>
          <SelectItem value="alta">Alta</SelectItem>
          <SelectItem value="media">Média</SelectItem>
          <SelectItem value="baixa">Baixa</SelectItem>
        </SelectContent>
      </Select>
      {tags.length > 0 && (
        <Select value={params.get("etiqueta") ?? ALL} onValueChange={(v) => update("etiqueta", v)}>
          <SelectTrigger className="w-44" aria-label="Etiqueta">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Qualquer etiqueta</SelectItem>
            {tags.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select value={params.get("status") ?? "abertas"} onValueChange={(v) => update("status", v === "abertas" ? null : v)}>
        <SelectTrigger className="w-36" aria-label="Situação">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="abertas">Em aberto</SelectItem>
          <SelectItem value="concluidas">Concluídas</SelectItem>
          <SelectItem value="todas">Todas</SelectItem>
        </SelectContent>
      </Select>
      </MobileFilters>
      {pending && <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-label="Atualizando" />}
    </div>
  );
}
