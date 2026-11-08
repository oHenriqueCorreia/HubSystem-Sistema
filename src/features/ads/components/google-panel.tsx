"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, Ban, LoaderCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormField } from "@/components/app/form-field";
import { formatInt, formatMoney, formatPct } from "../format";
import { addGoogleKeyword, addGoogleNegative, getKeywordIdeas, setGoogleKeywordStatus } from "../google-actions";
import type { KeywordIdea, KeywordRow, SearchTermRow } from "@/lib/ads/google-ads";

type Match = "EXACT" | "PHRASE" | "BROAD";
const MATCH: Record<string, string> = { EXACT: "Exata", PHRASE: "Frase", BROAD: "Ampla" };
const MATCH_HINT: Record<Match, string> = {
  EXACT: "Só para a pesquisa igual (ou quase igual).",
  PHRASE: "Para pesquisas que contêm o sentido da frase.",
  BROAD: "Para pesquisas relacionadas. Alcança mais, com menos controle.",
};
const TERM_STATUS: Record<string, string> = { ADDED: "Já é palavra-chave", EXCLUDED: "Negativada", ADDED_EXCLUDED: "Adicionada e negativada", NONE: "" };

type Sort = "costCents" | "clicks" | "conversions" | "impressions";

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message);
        after?.();
      } else toast.error(res.message);
      router.refresh();
    });
  return { pending, run };
}

function Toolbar({ query, setQuery, sort, setSort, count, label }: { query: string; setQuery: (v: string) => void; sort: Sort; setSort: (v: Sort) => void; count: number; label: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <p className="text-sm font-semibold">
        {count.toLocaleString("pt-BR")} {label}
      </p>
      <div className="flex flex-wrap gap-2">
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar…" aria-label="Buscar" className="h-9 w-48" autoComplete="off" />
        <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
          <SelectTrigger size="sm" className="w-44" aria-label="Ordenar por">
            <ArrowDown className="size-3.5" aria-hidden="true" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="costCents">Maior custo</SelectItem>
            <SelectItem value="clicks">Mais cliques</SelectItem>
            <SelectItem value="conversions">Mais conversões</SelectItem>
            <SelectItem value="impressions">Mais impressões</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function MetricCells({ r, currency }: { r: { impressions: number; clicks: number; costCents: number; conversions: number }; currency: string }) {
  const money = (c: number) => formatMoney(c, currency);
  return (
    <>
      <TableCell className="tabular text-right">{formatInt(r.impressions)}</TableCell>
      <TableCell className="tabular text-right">{formatInt(r.clicks)}</TableCell>
      <TableCell className="tabular text-right">{formatPct(r.impressions ? r.clicks / r.impressions : null)}</TableCell>
      <TableCell className="tabular text-right font-medium">{money(r.costCents)}</TableCell>
      <TableCell className="tabular text-right">{r.clicks ? money(r.costCents / r.clicks) : "—"}</TableCell>
      <TableCell className="tabular text-right">{r.conversions.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</TableCell>
      <TableCell className="tabular text-right">{r.conversions ? money(r.costCents / r.conversions) : "—"}</TableCell>
    </>
  );
}

const METRIC_HEADS = ["Impressões", "Cliques", "CTR", "Custo", "CPC médio", "Conversões", "Custo/conv."];

function useList<T extends { impressions: number; clicks: number; costCents: number; conversions: number }>(rows: T[], text: (r: T) => string) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("costCents");
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => !q || text(r).toLowerCase().includes(q)).sort((a, b) => b[sort] - a[sort] || b.impressions - a.impressions);
  }, [rows, query, sort, text]);
  return { query, setQuery, sort, setSort, list };
}

const keywordText = (r: KeywordRow) => `${r.text} ${r.campaign} ${r.adGroup}`;
const termText = (r: SearchTermRow) => `${r.term} ${r.keyword ?? ""} ${r.campaign} ${r.adGroup}`;

export function KeywordsTable({ rows, accountId, canManage, currency }: { rows: KeywordRow[]; accountId: string; canManage: boolean; currency: string }) {
  const { query, setQuery, sort, setSort, list } = useList(rows, keywordText);
  const { pending, run } = useAction();
  return (
    <section aria-label="Palavras-chave" className="grid gap-3">
      <Toolbar query={query} setQuery={setQuery} sort={sort} setSort={setSort} count={list.length} label={list.length === 1 ? "palavra-chave" : "palavras-chave"} />
      {!rows.length ? (
        <p className="rounded-xl border border-dashed bg-surface px-4 py-6 text-sm text-muted-foreground">Esta conta não tem palavras-chave. Campanhas Performance Max e de Display não usam palavras-chave.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-surface">
          <Table aria-label="Palavras-chave">
            <TableHeader>
              <TableRow>
                <TableHead>Palavra-chave</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Índice de qualidade</TableHead>
                {METRIC_HEADS.map((h) => (
                  <TableHead key={h} className="text-right">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((r) => (
                <TableRow key={`${r.adGroupId}~${r.criterionId}`}>
                  <TableCell className="min-w-56 max-w-80">
                    <div className="grid gap-0.5">
                      <span className="font-medium break-words">
                        {r.text} <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{MATCH[r.matchType] ?? r.matchType}</span>
                      </span>
                      <span className="text-xs break-words text-muted-foreground">
                        {r.campaign} › {r.adGroup}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      {canManage && (r.status === "ENABLED" || r.status === "PAUSED") && (
                        <Switch
                          checked={r.status === "ENABLED"}
                          disabled={pending}
                          aria-label={`${r.status === "ENABLED" ? "Pausar" : "Ativar"} ${r.text}`}
                          onCheckedChange={(v) => run(() => setGoogleKeywordStatus({ accountId, adGroupId: r.adGroupId, criterionId: r.criterionId, text: r.text, active: v }))}
                        />
                      )}
                      {r.status === "ENABLED" ? "Ativa" : r.status === "PAUSED" ? "Pausada" : r.status}
                    </span>
                  </TableCell>
                  <TableCell className={cn("tabular text-right", r.qualityScore != null && r.qualityScore <= 4 && "font-medium text-danger")}>{r.qualityScore != null ? `${r.qualityScore}/10` : "—"}</TableCell>
                  <MetricCells r={r} currency={currency} />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

type TermAction = { kind: "adicionar" | "negativar"; term: SearchTermRow } | null;

function TermDialog({ action, onClose, accountId }: { action: TermAction; onClose: () => void; accountId: string }) {
  const [match, setMatch] = useState<Match>("PHRASE");
  const [text, setText] = useState("");
  const { pending, run } = useAction();
  const open = Boolean(action);
  const t = action?.term;
  const add = action?.kind === "adicionar";
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !pending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        {t && (
          <>
            <DialogHeader>
              <DialogTitle>{add ? "Adicionar como palavra-chave" : "Negativar pesquisa"}</DialogTitle>
              <DialogDescription>
                {add ? (
                  <>
                    Entra no grupo <strong className="font-medium text-foreground">{t.adGroup}</strong>.
                  </>
                ) : (
                  <>
                    Os anúncios da campanha <strong className="font-medium text-foreground">{t.campaign}</strong> deixam de aparecer para essa pesquisa.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <FormField label={add ? "Palavra-chave" : "Pesquisa a negativar"}>
              <Input value={text || t.term} onChange={(e) => setText(e.target.value)} maxLength={80} autoComplete="off" />
            </FormField>
            <FormField label="Correspondência" hint={MATCH_HINT[match]}>
              <Select value={match} onValueChange={(v) => setMatch(v as Match)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EXACT">Exata</SelectItem>
                  <SelectItem value="PHRASE">Frase</SelectItem>
                  <SelectItem value="BROAD">Ampla</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={pending}>
                Cancelar
              </Button>
              <Button
                variant={add ? "default" : "destructive"}
                disabled={pending}
                onClick={() =>
                  run(
                    () =>
                      add
                        ? addGoogleKeyword({ accountId, adGroupId: t.adGroupId, text: text || t.term, matchType: match })
                        : addGoogleNegative({ accountId, campaignId: t.campaignId, text: text || t.term, matchType: match }),
                    () => {
                      setText("");
                      onClose();
                    },
                  )
                }
              >
                {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} {add ? "Adicionar palavra-chave" : "Negativar"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TermActions({ r, onAction }: { r: SearchTermRow; onAction: (a: TermAction) => void }) {
  if (r.status !== "NONE") return null;
  return (
    <span className="flex gap-1">
      <Button variant="outline" size="sm" onClick={() => onAction({ kind: "adicionar", term: r })} aria-label={`Adicionar “${r.term}” como palavra-chave`}>
        <Plus aria-hidden="true" /> Adicionar
      </Button>
      <Button variant="ghost" size="sm" onClick={() => onAction({ kind: "negativar", term: r })} aria-label={`Negativar “${r.term}”`}>
        <Ban aria-hidden="true" /> Negativar
      </Button>
    </span>
  );
}

function TermsTable({ rows, canManage, currency, onAction, label }: { rows: SearchTermRow[]; canManage: boolean; currency: string; onAction: (a: TermAction) => void; label: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-surface">
      <Table aria-label={label}>
        <TableHeader>
          <TableRow>
            <TableHead>Termo pesquisado</TableHead>
            {METRIC_HEADS.map((h) => (
              <TableHead key={h} className="text-right">
                {h}
              </TableHead>
            ))}
            {canManage && <TableHead className="text-right">Ações</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.adGroupId}~${r.term}`}>
              <TableCell className="min-w-56 max-w-80">
                <div className="grid gap-0.5">
                  <span className="font-medium break-words">{r.term}</span>
                  <span className="text-xs break-words text-muted-foreground">
                    {r.keyword ? `Pela palavra “${r.keyword}” · ` : ""}
                    {r.campaign} › {r.adGroup}
                  </span>
                  {TERM_STATUS[r.status] && <span className="text-xs text-success">{TERM_STATUS[r.status]}</span>}
                </div>
              </TableCell>
              <MetricCells r={r} currency={currency} />
              {canManage && (
                <TableCell className="text-right">
                  <TermActions r={r} onAction={onAction} />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function SearchTermsView({ rows, accountId, canManage, currency }: { rows: SearchTermRow[]; accountId: string; canManage: boolean; currency: string }) {
  const { query, setQuery, sort, setSort, list } = useList(rows, termText);
  const [action, setAction] = useState<TermAction>(null);
  return (
    <section aria-label="Termos de pesquisa" className="grid gap-3">
      <Toolbar query={query} setQuery={setQuery} sort={sort} setSort={setSort} count={list.length} label={list.length === 1 ? "termo pesquisado" : "termos pesquisados"} />
      {!rows.length ? (
        <p className="rounded-xl border border-dashed bg-surface px-4 py-6 text-sm text-muted-foreground">Nenhuma pesquisa acionou os anúncios neste período.</p>
      ) : (
        <TermsTable rows={list.slice(0, 500)} canManage={canManage} currency={currency} onAction={setAction} label="Termos de pesquisa" />
      )}
      {list.length > 500 && <p className="text-xs text-muted-foreground">Mostrando os 500 primeiros. Use a busca para encontrar outros.</p>}
      <TermDialog key={action ? `${action.kind}~${action.term.adGroupId}~${action.term.term}` : "fechado"} action={action} onClose={() => setAction(null)} accountId={accountId} />
    </section>
  );
}

/** Sugestões a partir das pesquisas reais: o que converte vira palavra-chave; o que só gasta, negativa. */
export function SuggestionsView({
  rows,
  accountId,
  canManage,
  currency,
  adGroups,
}: {
  rows: SearchTermRow[];
  accountId: string;
  canManage: boolean;
  currency: string;
  adGroups: { id: string; name: string }[];
}) {
  const [action, setAction] = useState<TermAction>(null);
  const fresh = rows.filter((r) => r.status === "NONE");
  const good = fresh.filter((r) => r.conversions > 0 || r.clicks >= 3).sort((a, b) => b.conversions - a.conversions || b.clicks - a.clicks).slice(0, 50);
  const waste = fresh
    .filter((r) => r.conversions === 0 && r.costCents > 0 && r.clicks >= 2)
    .sort((a, b) => b.costCents - a.costCents)
    .slice(0, 50);
  const wasted = waste.reduce((s, r) => s + r.costCents, 0);
  return (
    <div className="grid gap-8">
      <KeywordPlanner accountId={accountId} adGroups={adGroups} canManage={canManage} currency={currency} />
      <section aria-labelledby="sug-boas" className="grid gap-3">
        <div className="grid gap-1">
          <h3 id="sug-boas" className="text-base font-semibold">
            Para virar palavra-chave ({good.length})
          </h3>
          <p className="text-sm text-muted-foreground">Pesquisas que trouxeram conversões ou cliques e ainda não são palavras-chave.</p>
        </div>
        {good.length ? (
          <TermsTable rows={good} canManage={canManage} currency={currency} onAction={setAction} label="Pesquisas para virar palavra-chave" />
        ) : (
          <p className="rounded-xl border border-dashed bg-surface px-4 py-6 text-sm text-muted-foreground">Nenhuma pesquisa nova com resultado neste período.</p>
        )}
      </section>
      <section aria-labelledby="sug-ruins" className="grid gap-3">
        <div className="grid gap-1">
          <h3 id="sug-ruins" className="text-base font-semibold">
            Para negativar ({waste.length})
          </h3>
          <p className="text-sm text-muted-foreground">
            Pesquisas com cliques e nenhuma conversão{wasted ? `: ${formatMoney(wasted, currency)} gastos no período` : ""}. Negativar evita pagar de novo por elas.
          </p>
        </div>
        {waste.length ? (
          <TermsTable rows={waste} canManage={canManage} currency={currency} onAction={setAction} label="Pesquisas para negativar" />
        ) : (
          <p className="rounded-xl border border-dashed bg-surface px-4 py-6 text-sm text-muted-foreground">Nenhuma pesquisa gastando sem converter neste período.</p>
        )}
      </section>
      <TermDialog key={action ? `${action.kind}~${action.term.adGroupId}~${action.term.term}` : "fechado"} action={action} onClose={() => setAction(null)} accountId={accountId} />
    </div>
  );
}

const COMPETITION: Record<string, string> = { LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta" };

/** Planejador de palavras-chave do Google: ideias com volume de buscas e lance sugerido. */
export function KeywordPlanner({ accountId, adGroups, canManage, currency }: { accountId: string; adGroups: { id: string; name: string }[]; canManage: boolean; currency: string }) {
  const [seeds, setSeeds] = useState("");
  const [url, setUrl] = useState("");
  const [ideas, setIdeas] = useState<KeywordIdea[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState<KeywordIdea | null>(null);
  const [group, setGroup] = useState(adGroups[0]?.id ?? "");
  const [match, setMatch] = useState<Match>("PHRASE");
  const [searching, startSearch] = useTransition();
  const { pending, run } = useAction();
  const money = (c: number | null) => (c == null ? "—" : formatMoney(c, currency));
  const canAdd = canManage && adGroups.length > 0;

  function search() {
    setNotice(null);
    startSearch(async () => {
      const keywords = seeds
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10);
      const res = await getKeywordIdeas({ accountId, keywords, url: url.trim() || null });
      if (res.ok) setIdeas(res.data.ideas);
      else {
        setIdeas(null);
        setNotice(res.message ?? null);
      }
    });
  }

  return (
    <section aria-labelledby="planejador" className="grid gap-3 rounded-xl border bg-surface p-4 sm:p-5">
      <div className="grid gap-1">
        <h3 id="planejador" className="text-base font-semibold">
          Planejador de palavras-chave
        </h3>
        <p className="text-sm text-muted-foreground">Ideias novas do Google, com quantas vezes cada uma é buscada por mês no Brasil.</p>
      </div>
      <form
        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <FormField label="Palavras de partida" hint="Separe por vírgula. Até 10.">
          <Input value={seeds} onChange={(e) => setSeeds(e.target.value)} placeholder="Ex.: brindes personalizados, canecas…" autoComplete="off" />
        </FormField>
        <FormField label="Site" optional>
          <Input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" autoComplete="off" spellCheck={false} />
        </FormField>
        <Button type="submit" disabled={searching || (!seeds.trim() && !url.trim())}>
          {searching && <LoaderCircle className="animate-spin" aria-hidden="true" />} Buscar ideias
        </Button>
      </form>
      {notice && <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning">{notice}</p>}
      {ideas && !ideas.length && <p className="text-sm text-muted-foreground">O Google não trouxe ideias para essas palavras. Tente termos mais gerais.</p>}
      {ideas && ideas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border">
          <Table aria-label="Ideias de palavras-chave">
            <TableHeader>
              <TableRow>
                <TableHead>Palavra-chave</TableHead>
                <TableHead className="text-right">Buscas por mês</TableHead>
                <TableHead>Concorrência</TableHead>
                <TableHead className="text-right">Lance sugerido</TableHead>
                {canAdd && <TableHead className="text-right">Ação</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ideas.map((i) => (
                <TableRow key={i.text}>
                  <TableCell className="min-w-48 font-medium break-words">{i.text}</TableCell>
                  <TableCell className="tabular text-right">{i.avgMonthlySearches != null ? formatInt(i.avgMonthlySearches) : "—"}</TableCell>
                  <TableCell>{COMPETITION[i.competition ?? ""] ?? "—"}</TableCell>
                  <TableCell className="tabular text-right whitespace-nowrap">
                    {i.lowBidCents != null || i.highBidCents != null ? `${money(i.lowBidCents)} a ${money(i.highBidCents)}` : "—"}
                  </TableCell>
                  {canAdd && (
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setAdding(i)} aria-label={`Adicionar “${i.text}”`}>
                        <Plus aria-hidden="true" /> Adicionar
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog open={Boolean(adding)} onOpenChange={(v) => !v && !pending && setAdding(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar “{adding?.text}”</DialogTitle>
            <DialogDescription>A palavra-chave entra ativa no grupo escolhido.</DialogDescription>
          </DialogHeader>
          <FormField label="Grupo de anúncios">
            <Select value={group} onValueChange={setGroup}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {adGroups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Correspondência" hint={MATCH_HINT[match]}>
            <Select value={match} onValueChange={(v) => setMatch(v as Match)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EXACT">Exata</SelectItem>
                <SelectItem value="PHRASE">Frase</SelectItem>
                <SelectItem value="BROAD">Ampla</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button disabled={pending || !group} onClick={() => adding && run(() => addGoogleKeyword({ accountId, adGroupId: group, text: adding.text, matchType: match }), () => setAdding(null))}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Adicionar palavra-chave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
