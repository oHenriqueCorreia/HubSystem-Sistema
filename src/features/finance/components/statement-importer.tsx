"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CopyCheck, FileUp, Link2, LoaderCircle, Search, Sparkles } from "lucide-react";
import Papa from "papaparse";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormAlert, FormField } from "@/components/app/form-field";
import { MoneyInput } from "@/components/app/money-input";
import { formatBRL } from "@/domain/shared/money";
import { formatDate, todayLocal } from "@/domain/shared/dates";
import { lineHashes, parseOfx, parsePdfText, parseTable, type StatementLine } from "@/domain/finance/statement";
import { saveCategory } from "../actions";
import { analyzeStatement, commitStatement, saveCategoryRule } from "../ops-actions";
import { SCOPE_LABEL, type Account, type Category, type FinanceScope } from "../types";
import { decodeTextFile } from "@/domain/shared/encoding";

type Lookups = Partial<Record<FinanceScope, { accounts: Account[]; categories: Category[] }>>;
type Candidate = { id: string; scope: FinanceScope; description: string; amount_cents: number; due_date: string; status: string };
type Row = StatementLine & {
  scope: FinanceScope;
  categoryId: string | null;
  action: "criar" | "conciliar" | "ignorar";
  txnId: string | null;
  duplicate: "importado" | "lancado" | null;
  candidates: Candidate[];
  suggested: boolean;
};
type Format = "pdf" | "ofx" | "csv" | "planilha";
type Filter = "todas" | "duplicatas" | "conferir" | "conciliar" | "sem_categoria" | "ignoradas";

const FILTERS: [Filter, string][] = [
  ["todas", "Todas"],
  ["conferir", "Para conferir"],
  ["duplicatas", "Possíveis duplicatas"],
  ["conciliar", "Para conciliar"],
  ["sem_categoria", "Sem categoria"],
  ["ignoradas", "Ignoradas"],
];
const PAGE = 50;
const NONE = "__nenhuma__";
const NEW_CATEGORY = "__nova__";

const decodeText = async (file: File) => decodeTextFile(await file.arrayBuffer());

export function StatementImporter({ scope, lookups }: { scope: FinanceScope; lookups: Lookups }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<Format>("csv");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unreadable, setUnreadable] = useState(0);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("todas");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [accounts, setAccounts] = useState<Partial<Record<FinanceScope, string>>>(() => Object.fromEntries((Object.keys(lookups) as FinanceScope[]).map((s) => [s, lookups[s]?.accounts.find((a) => a.is_active)?.id ?? ""])));
  const [extraCategories, setExtraCategories] = useState<(Category & { scope: FinanceScope })[]>([]);
  const [saving, startSaving] = useTransition();
  const [limit, setLimit] = useState(PAGE);
  const scopes = Object.keys(lookups) as FinanceScope[];

  const categoriesOf = (s: FinanceScope, direction: "entrada" | "saida") => {
    const kind = direction === "entrada" ? "receita" : "despesa";
    return [...(lookups[s]?.categories ?? []), ...extraCategories.filter((c) => c.scope === s)].filter((c) => c.is_active && c.kind === kind);
  };

  async function readFile(file: File): Promise<{ lines: StatementLine[]; format: Format; unreadable: number }> {
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf")) {
      const body = new FormData();
      body.set("arquivo", file);
      const res = await fetch("/api/finance/statement-pdf", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { lines?: string[]; error?: string };
      if (!res.ok || !json.lines) throw new Error(json.error ?? "Não foi possível ler o PDF.");
      const parsed = parsePdfText(json.lines, Number(todayLocal().slice(0, 4)));
      if (!parsed.lines.length) throw new Error("Não encontramos movimentações neste PDF. Use OFX ou CSV do banco.");
      return { lines: parsed.lines, format: "pdf", unreadable: parsed.unreadable };
    }
    if (name.endsWith(".ofx") || name.endsWith(".qfx")) {
      const lines = parseOfx(await decodeText(file));
      if (!lines.length) throw new Error("Este OFX não tem movimentações.");
      return { lines, format: "ofx", unreadable: 0 };
    }
    let table: unknown[][];
    let fmt: Format = "csv";
    if (name.endsWith(".csv") || name.endsWith(".txt")) {
      table = Papa.parse<unknown[]>(await decodeText(file), { skipEmptyLines: true }).data;
    } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const XLSX = await import("xlsx");
      const book = XLSX.read(await file.arrayBuffer());
      table = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]], { header: 1, raw: true });
      fmt = "planilha";
    } else {
      throw new Error("Use um arquivo PDF, OFX, CSV ou planilha (XLSX).");
    }
    const parsed = parseTable(table);
    if (!parsed.headerFound) throw new Error("Não encontramos as colunas de data e valor. Confira se a primeira linha de títulos tem Data, Descrição e Valor.");
    if (!parsed.lines.length) throw new Error("O arquivo não tem movimentações.");
    return { lines: parsed.lines, format: fmt, unreadable: 0 };
  }

  async function onFile(file: File) {
    setError(null);
    setLoading(true);
    setRows(null);
    setSelected(new Set());
    setFilter("todas");
    setLimit(PAGE);
    try {
      const read = await readFile(file);
      const hashes = lineHashes(read.lines);
      const res = await analyzeStatement({ hashes: [...hashes.values()], lines: read.lines.map((l) => ({ id: l.id, date: l.date, amountCents: l.amountCents, direction: l.direction, description: l.description })) });
      if (!res.ok) throw new Error(res.message);
      const byId = new Map(res.data.lines.map((l) => [l.id, l]));
      const imported = new Set(res.data.importedHashes);
      setRows(
        read.lines.map((l) => {
          const a = byId.get(l.id);
          const rule = a?.rule && scopes.includes(a.rule.scope) ? a.rule : null;
          const already = imported.has(hashes.get(l.id)!);
          const dup = already ? "importado" : a?.duplicate ? "lancado" : null;
          const candidates = (a?.candidates ?? []) as Candidate[];
          return {
            ...l,
            scope: rule?.scope ?? candidates[0]?.scope ?? scope,
            categoryId: rule?.category_id ?? null,
            // Duplicata começa ignorada e cobrança parecida começa conciliando: nada vira segunda entrada sem querer.
            action: dup ? "ignorar" : candidates.length ? "conciliar" : "criar",
            txnId: candidates[0]?.id ?? null,
            duplicate: dup,
            candidates,
            suggested: Boolean(rule),
          };
        }),
      );
      setFileName(file.name);
      setFormat(read.format);
      setUnreadable(read.unreadable);
    } catch (e) {
      setError((e as Error).message || "Não foi possível ler o arquivo.");
    } finally {
      setLoading(false);
      if (input.current) input.current.value = "";
    }
  }

  const patch = (id: string, change: Partial<Row>) => setRows((list) => list?.map((r) => (r.id === id ? { ...r, ...change } : r)) ?? null);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (term && !r.description.toLowerCase().includes(term)) return false;
      if (filter === "duplicatas") return Boolean(r.duplicate);
      if (filter === "conferir") return r.confidence === "baixa";
      if (filter === "conciliar") return r.action === "conciliar";
      if (filter === "sem_categoria") return r.action === "criar" && !r.categoryId;
      if (filter === "ignoradas") return r.action === "ignorar";
      return true;
    });
  }, [rows, q, filter]);

  const summary = useMemo(() => {
    const out = Object.fromEntries(scopes.map((s) => [s, { entrada: 0, saida: 0, count: 0 }])) as Record<string, { entrada: number; saida: number; count: number }>;
    let conciliar = 0;
    let ignorar = 0;
    for (const r of rows ?? []) {
      if (r.action === "ignorar") ignorar++;
      else if (r.action === "conciliar") conciliar++;
      else if (out[r.scope]) {
        out[r.scope][r.direction] += r.amountCents;
        out[r.scope].count++;
      }
    }
    return { areas: out, conciliar, ignorar };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as áreas não mudam na tela
  }, [rows]);

  const problems = useMemo(() => (rows ?? []).filter((r) => r.action !== "ignorar" && (!r.date || !r.amountCents || !r.description.trim() || (r.action === "conciliar" && !r.txnId))).length, [rows]);
  const missingAccount = (rows ?? []).some((r) => r.action === "criar" && !accounts[r.scope]);

  function bulk(change: Partial<Row>) {
    setRows((list) => list?.map((r) => (selected.has(r.id) ? { ...r, ...change, ...(change.scope && change.scope !== r.scope ? { categoryId: null } : {}) } : r)) ?? null);
  }

  function commit() {
    if (!rows) return;
    startSaving(async () => {
      const hashes = lineHashes(rows);
      const res = await commitStatement({
        fileName,
        format,
        rows: rows.map((r) => ({
          action: r.action,
          date: r.date ?? todayLocal(),
          description: r.description,
          amount_cents: r.amountCents || 1,
          direction: r.direction,
          hash: hashes.get(r.id)!,
          scope: r.action === "criar" ? r.scope : undefined,
          category_id: r.action === "criar" ? r.categoryId : undefined,
          // Conciliar usa a conta da área do lançamento escolhido, que pode ser a outra.
          account_id: r.action === "ignorar" ? undefined : (accounts[r.action === "conciliar" ? (r.candidates.find((c) => c.id === r.txnId)?.scope ?? r.scope) : r.scope] ?? null),
          txn_id: r.action === "conciliar" ? (r.txnId ?? undefined) : undefined,
        })),
      });
      if (!res.ok) return void toast.error(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message);
      toast.success(res.message);
      setRows(null);
      setFileName("");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4">
      <section aria-labelledby="enviar-extrato" className="grid gap-2 rounded-xl border bg-surface p-4">
        <h2 id="enviar-extrato" className="font-semibold">
          Importar extrato
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">PDF, OFX, CSV ou planilha. Primeiro você revisa: nada é gravado até confirmar. Se o banco oferecer OFX, prefira: ele traz o código de cada movimentação.</p>
        <input ref={input} type="file" accept=".pdf,.ofx,.qfx,.csv,.txt,.xlsx,.xls" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        <Button variant={rows ? "outline" : "default"} className="justify-self-start" disabled={loading} onClick={() => input.current?.click()}>
          {loading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <FileUp aria-hidden="true" />} {rows ? "Trocar arquivo" : "Escolher arquivo"}
        </Button>
        <FormAlert>{error}</FormAlert>
      </section>

      {loading && (
        <div className="grid gap-2" aria-busy="true" aria-label="Lendo o arquivo">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {rows && (
        <>
          <section aria-label="Resumo por área" className="grid gap-3 md:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]">
            {scopes.map((s) => (
              <div key={s} className={cn("grid gap-2 rounded-xl border-l-4 border bg-surface p-3 text-sm", s === "pessoal" ? "border-l-ctx-personal" : "border-l-ctx-company")}>
                <h3 className="font-semibold">{SCOPE_LABEL[s]}</h3>
                <p className="tabular text-xs text-muted-foreground">
                  {summary.areas[s]?.count ?? 0} a criar. Entradas <span className="text-success">{formatBRL(summary.areas[s]?.entrada ?? 0)}</span>, saídas <span className="text-danger">{formatBRL(summary.areas[s]?.saida ?? 0)}</span>
                </p>
                <FormField label="Conta">
                  <Select value={accounts[s] ?? ""} onValueChange={(v) => setAccounts((a) => ({ ...a, [s]: v }))}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Escolha a conta" />
                    </SelectTrigger>
                    <SelectContent>
                      {(lookups[s]?.accounts ?? [])
                        .filter((a) => a.is_active)
                        .map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </FormField>
              </div>
            ))}
            <div className="grid content-start gap-1 rounded-xl border bg-surface p-3 text-sm">
              <h3 className="font-semibold">{fileName}</h3>
              <p className="text-xs text-muted-foreground tabular">
                {rows.length} linha(s), {summary.conciliar} para conciliar, {summary.ignorar} ignorada(s).
              </p>
              {unreadable > 0 && (
                <p className="flex items-start gap-1 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> {unreadable} linha(s) do PDF sem valor legível. Corrija ou ignore.
                </p>
              )}
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar descrição…" aria-label="Pesquisar descrição" className="pl-8" />
            </div>
            <nav aria-label="Filtrar linhas" className="flex gap-1 overflow-x-auto">
              {FILTERS.map(([k, label]) => (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={cn("rounded-md px-2 py-1 text-sm whitespace-nowrap", filter === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
                  {label}
                </button>
              ))}
            </nav>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={visible.length > 0 && visible.every((r) => selected.has(r.id))}
                onCheckedChange={(v) => setSelected(v ? new Set([...selected, ...visible.map((r) => r.id)]) : new Set([...selected].filter((id) => !visible.some((r) => r.id === id))))}
              />
              Selecionar visíveis
            </label>
            <span className="tabular text-muted-foreground">{selected.size} selecionada(s)</span>
            {selected.size > 0 && (
              <>
                {scopes.length > 1 && scopes.map((s) => (
                  <Button key={s} size="xs" variant="outline" onClick={() => bulk({ scope: s })}>
                    Mandar para {SCOPE_LABEL[s]}
                  </Button>
                ))}
                <Button size="xs" variant="outline" onClick={() => bulk({ action: "ignorar" })}>
                  Ignorar
                </Button>
                <Button size="xs" variant="outline" onClick={() => bulk({ action: "criar" })}>
                  Criar lançamentos
                </Button>
              </>
            )}
          </div>

          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma linha com estes filtros.</p>
          ) : (
            <ul className="grid gap-2">
              {visible.slice(0, limit).map((r) => (
                <LineRow
                  key={r.id}
                  row={r}
                  selected={selected.has(r.id)}
                  onSelect={(v) => setSelected((set) => {
                    const next = new Set(set);
                    if (v) next.add(r.id);
                    else next.delete(r.id);
                    return next;
                  })}
                  onChange={(c) => patch(r.id, c)}
                  scopes={scopes}
                  categories={categoriesOf(r.scope, r.direction)}
                  onCategoryCreated={(c) => setExtraCategories((l) => [...l, c])}
                />
              ))}
            </ul>
          )}
          {visible.length > limit && (
            <Button variant="outline" className="justify-self-center" onClick={() => setLimit((n) => n + PAGE)}>
              Mostrar mais {Math.min(PAGE, visible.length - limit)} de {visible.length - limit}
            </Button>
          )}

          <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-surface p-3 shadow-md">
            <p className="text-sm">
              {problems > 0 ? (
                <span className="text-danger">{problems} linha(s) precisam de data, valor ou lançamento. Corrija ou ignore.</span>
              ) : missingAccount ? (
                <span className="text-danger">Escolha a conta de cada área.</span>
              ) : (
                <span className="text-muted-foreground">Tudo revisado. Confirme para gravar.</span>
              )}
            </p>
            <ConfirmDialog
              trigger={<Button disabled={saving || problems > 0 || missingAccount}>{saving && <LoaderCircle className="animate-spin" aria-hidden="true" />} Confirmar e gravar</Button>}
              title="Gravar esta importação?"
              description={`${scopes.map((s) => `${SCOPE_LABEL[s]}: ${summary.areas[s]?.count ?? 0} novo(s)`).join(". ")}. ${summary.conciliar} conciliado(s) sem criar entrada nova e ${summary.ignorar} ignorado(s). Se algo falhar, nada é gravado.`}
              confirmLabel="Gravar"
              onConfirm={async () => commit()}
            />
          </div>
        </>
      )}
    </div>
  );
}

function LineRow({ row, selected, onSelect, onChange, scopes, categories, onCategoryCreated }: { row: Row; selected: boolean; onSelect: (v: boolean) => void; onChange: (c: Partial<Row>) => void; scopes: FinanceScope[]; categories: Category[]; onCategoryCreated: (c: Category & { scope: FinanceScope }) => void }) {
  const [newName, setNewName] = useState<string | null>(null);
  const [rule, setRule] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ignored = row.action === "ignorar";

  function createCategory() {
    if (!newName?.trim()) return;
    const name = newName.trim();
    startTransition(async () => {
      const res = await saveCategory({ scope: row.scope, name, kind: row.direction === "entrada" ? "receita" : "despesa", isActive: true });
      if (!res.ok || !res.data) return void toast.error(res.message ?? "Não foi possível criar a categoria.");
      const id = (res.data as { id: string }).id;
      onCategoryCreated({ id, name, kind: row.direction === "entrada" ? "receita" : "despesa", is_active: true, scope: row.scope });
      onChange({ categoryId: id });
      setNewName(null);
    });
  }

  function saveRule() {
    if (!rule?.trim() || !row.categoryId) return;
    startTransition(async () => {
      const res = await saveCategoryRule({ scope: row.scope, pattern: rule, categoryId: row.categoryId! });
      if (!res.ok) return void toast.error(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message);
      toast.success(res.message);
      setRule(null);
    });
  }

  return (
    <li className={cn("grid gap-2 rounded-lg border bg-surface p-3 text-sm", ignored && "opacity-60", row.confidence === "baixa" && !ignored && "border-warning/60")}>
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox checked={selected} onCheckedChange={(v) => onSelect(Boolean(v))} aria-label={`Selecionar ${row.description}`} />
        {row.duplicate && (
          <span className="inline-flex items-center gap-1 rounded bg-warning-soft px-1.5 py-0.5 text-xs text-warning">
            <CopyCheck className="size-3.5" aria-hidden="true" /> {row.duplicate === "importado" ? "Já importada antes" : "Possível duplicata"}
          </span>
        )}
        {row.suggested && (
          <span className="inline-flex items-center gap-1 rounded bg-info-soft px-1.5 py-0.5 text-xs text-info">
            <Sparkles className="size-3.5" aria-hidden="true" /> Categoria sugerida
          </span>
        )}
        {row.problem && (
          <span className="inline-flex items-center gap-1 text-xs text-warning">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" /> {row.problem}
          </span>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-[9.5rem_minmax(0,1fr)_8.5rem_7.5rem]">
        <Input type="date" aria-label="Data" value={row.date ?? ""} onChange={(e) => onChange({ date: e.target.value || null })} />
        <Input aria-label="Descrição" value={row.description} maxLength={300} onChange={(e) => onChange({ description: e.target.value })} />
        <MoneyInput aria-label="Valor" value={row.amountCents || null} onChange={(v) => onChange({ amountCents: v ?? 0 })} />
        <Select value={row.direction} onValueChange={(v) => onChange({ direction: v as Row["direction"], categoryId: null, action: row.action === "conciliar" ? "criar" : row.action })}>
          <SelectTrigger className="w-full" aria-label="Entrada ou saída">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="entrada">Entrada</SelectItem>
            <SelectItem value="saida">Saída</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)]">
        <Select value={row.action} onValueChange={(v) => onChange({ action: v as Row["action"], txnId: v === "conciliar" ? (row.txnId ?? row.candidates[0]?.id ?? null) : row.txnId })}>
          <SelectTrigger className="w-full" aria-label="O que fazer">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="criar">Criar lançamento</SelectItem>
            {row.candidates.length > 0 && <SelectItem value="conciliar">Conciliar</SelectItem>}
            <SelectItem value="ignorar">Ignorar linha</SelectItem>
          </SelectContent>
        </Select>
        {row.action === "conciliar" && (
          <Select value={row.txnId ?? ""} onValueChange={(v) => onChange({ txnId: v })}>
            <SelectTrigger className="w-full sm:col-span-2" aria-label="Lançamento para conciliar">
              <Link2 className="size-4 shrink-0" aria-hidden="true" />
              <SelectValue placeholder="Escolha o lançamento" />
            </SelectTrigger>
            <SelectContent>
              {row.candidates.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {SCOPE_LABEL[c.scope]}: {c.description}, {formatBRL(c.amount_cents)}, vence {formatDate(c.due_date)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {row.action === "criar" && (
          <>
            {scopes.length > 1 ? (
              <Select value={row.scope} onValueChange={(v) => onChange({ scope: v as FinanceScope, categoryId: null })}>
                <SelectTrigger className="w-full" aria-label="Área">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scopes.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SCOPE_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="self-center text-xs text-muted-foreground">{SCOPE_LABEL[row.scope]}</p>
            )}
            <Select
              value={row.categoryId ?? NONE}
              onValueChange={(v) => {
                if (v === NEW_CATEGORY) return setNewName("");
                onChange({ categoryId: v === NONE ? null : v, suggested: false });
              }}
            >
              <SelectTrigger className="w-full" aria-label="Categoria">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sem categoria</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_CATEGORY}>Criar nova categoria…</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
      </div>
      {newName !== null && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            createCategory();
          }}
        >
          <Input autoFocus aria-label="Nome da nova categoria" placeholder="Nome da categoria…" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} className="min-w-0 flex-1" />
          <Button type="submit" size="sm" variant="outline" disabled={pending || !newName.trim()}>
            Criar
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setNewName(null)}>
            Cancelar
          </Button>
        </form>
      )}
      {row.action === "criar" && row.categoryId && (
        rule === null ? (
          <button type="button" className="justify-self-start text-xs text-primary hover:underline" onClick={() => setRule(row.description.split(/\s+/).slice(0, 2).join(" "))}>
            Sugerir esta categoria nas próximas importações
          </button>
        ) : (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveRule();
            }}
          >
            <FormField label="Quando a descrição tiver" className="min-w-0 flex-1">
              <Input autoFocus value={rule} maxLength={80} onChange={(e) => setRule(e.target.value)} />
            </FormField>
            <Button type="submit" size="sm" variant="outline" className="self-end" disabled={pending || rule.trim().length < 2}>
              Salvar regra
            </Button>
          </form>
        )
      )}
    </li>
  );
}
