"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, LoaderCircle, Undo2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormAlert } from "@/components/app/form-field";
import {
  LEAD_FIELDS,
  findDuplicatesInFile,
  headerSignature,
  matchExisting,
  segmentFromFileName,
  suggestMapping,
  validateRow,
  type ColumnMapping,
  type DuplicateInfo,
  type ImportRow,
  type LeadFieldKey,
  type ValidatedRow,
} from "@/domain/crm/import";
import { PROSPECTOR_SOURCE } from "@/domain/crm/prospector";
import { cn } from "cn";
import { checkExistingLeads, getImportMapping, importLeads, saveImportMapping, undoImport } from "../actions";
import type { ProspectorImports } from "../queries";
import { ProspectorPanel } from "./prospector-panel";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 10_000;
const CHUNK = 1000;
const IGNORE = "__ignorar__";
const STEPS = ["Arquivo", "Colunas", "Validação", "Confirmação", "Relatório"] as const;

type ParsedFile = { name: string; headers: string[]; rows: Record<string, string>[]; segment: string };
type Analysis = {
  perFile: { file: ParsedFile; valid: ImportRow[]; invalid: Extract<ValidatedRow, { ok: false }>[]; warnings: number }[];
  inFileDups: Map<string, DuplicateInfo>; // chave "arquivo:linha"
  existingDups: Map<string, DuplicateInfo>;
};
type FileResult = { file: string; importId: string; inserted: number; updated: number; skipped: number; invalid: number; errors: { linha: number; erro: string }[] };

/** Decodifica como UTF-8; se aparecerem caracteres inválidos, tenta Windows-1252 (Excel antigo). */
async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8.replace(/^﻿/, "");
  return new TextDecoder("windows-1252").decode(buf);
}

async function parseFile(file: File): Promise<ParsedFile> {
  if (file.size > MAX_BYTES) throw new Error(`${file.name}: arquivo maior que 10 MB.`);
  const ext = file.name.split(".").pop()?.toLowerCase();
  let headers: string[] = [];
  let rows: Record<string, string>[] = [];

  if (ext === "csv" || ext === "txt") {
    const text = await readText(file);
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
    headers = (parsed.meta.fields ?? []).filter(Boolean);
    rows = parsed.data;
  } else if (ext === "xlsx" || ext === "xls") {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
    headers = data.length ? Object.keys(data[0]).map((h) => h.trim()) : [];
    rows = data.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim(), String(v ?? "")])));
  } else {
    throw new Error(`${file.name}: formato não suportado. Use CSV ou XLSX.`);
  }

  if (!headers.length) throw new Error(`${file.name}: não encontramos a linha de cabeçalho.`);
  if (rows.length > MAX_ROWS) throw new Error(`${file.name}: mais de ${MAX_ROWS.toLocaleString("pt-BR")} linhas. Divida o arquivo.`);
  return { name: file.name, headers, rows, segment: segmentFromFileName(file.name) };
}

function key(file: string, line: number) {
  return `${file}:${line}`;
}

export function ImportWizard({
  pipelines,
  source = "file",
  prospector,
}: {
  pipelines: { id: string; name: string }[];
  source?: "file" | "prospector";
  prospector?: { added: ProspectorImports; segments: { id: string; name: string }[] };
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  const [mode, setMode] = useState<"skip" | "update">("skip");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [results, setResults] = useState<FileResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [pending, startTransition] = useTransition();

  const headers = files[0]?.headers ?? [];
  const sample = files[0]?.rows.slice(0, 20) ?? [];

  async function onFiles(list: FileList | File[], segment?: string) {
    setError(null);
    const arr = Array.from(list);
    if (!arr.length) return;
    try {
      const parsed = await Promise.all(arr.map(parseFile));
      const sig = headerSignature(parsed[0].headers);
      const mismatch = parsed.find((p) => headerSignature(p.headers) !== sig);
      if (mismatch) throw new Error(`“${mismatch.name}” tem colunas diferentes de “${parsed[0].name}”. Importe arquivos com o mesmo layout juntos.`);
      setFiles(segment ? parsed.map((p) => ({ ...p, segment })) : parsed);
      let m = suggestMapping(parsed[0].headers);
      const saved = await getImportMapping({ signature: sig });
      if (saved.ok && saved.data) m = saved.data as ColumnMapping;
      setMapping(m);
      setStep(1);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function analyze() {
    if (!mapping.name) {
      setError("Escolha qual coluna contém o nome do lead.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const perFile = files.map((file) => {
        const validated = file.rows.map((raw, i) => validateRow(raw, mapping, i + 2));
        const valid = validated.filter((v): v is Extract<ValidatedRow, { ok: true }> => v.ok);
        return {
          file,
          valid: valid.map((v) => ({ ...v.row, category: v.row.category })),
          invalid: validated.filter((v): v is Extract<ValidatedRow, { ok: false }> => !v.ok),
          warnings: valid.reduce((s, v) => s + v.warnings.length, 0),
        };
      });

      // Duplicados entre todos os arquivos selecionados.
      const flat = perFile.flatMap((pf, fi) => pf.valid.map((r) => ({ ...r, _line: fi * 1_000_000 + r._line })));
      const inFile = findDuplicatesInFile(flat);
      const inFileDups = new Map<string, DuplicateInfo>();
      for (const [line, info] of inFile) {
        const fi = Math.floor(line / 1_000_000);
        inFileDups.set(key(perFile[fi].file.name, line % 1_000_000), {
          ...info,
          line: line % 1_000_000,
          withLine: info.withLine != null ? info.withLine % 1_000_000 : undefined,
          withName: info.withLine != null ? perFile[Math.floor(info.withLine / 1_000_000)].file.name : undefined,
        });
      }

      const existing = await checkExistingLeads({
        placeIds: [...new Set(flat.map((r) => r.place_id).filter((v): v is string => Boolean(v)))],
        phones: [...new Set(flat.map((r) => r.phone_e164).filter((v): v is string => Boolean(v)))],
        emails: [...new Set(flat.map((r) => r.email).filter((v): v is string => Boolean(v)))],
      });
      if (!existing.ok) {
        setError(existing.message);
        return;
      }
      const ex = matchExisting(flat, existing.data);
      const existingDups = new Map<string, DuplicateInfo>();
      for (const [line, info] of ex) {
        const fi = Math.floor(line / 1_000_000);
        existingDups.set(key(perFile[fi].file.name, line % 1_000_000), { ...info, line: line % 1_000_000 });
      }

      setAnalysis({ perFile, inFileDups, existingDups });
      void saveImportMapping({ signature: headerSignature(headers), mapping: mapping as Record<string, string> });
      setStep(2);
    });
  }

  const totals = useMemo(() => {
    if (!analysis) return null;
    const valid = analysis.perFile.reduce((s, f) => s + f.valid.length, 0);
    const invalid = analysis.perFile.reduce((s, f) => s + f.invalid.length, 0);
    const toSend = valid - analysis.inFileDups.size;
    const existing = analysis.existingDups.size;
    return { valid, invalid, inFile: analysis.inFileDups.size, existing, toSend, newOnes: toSend - [...analysis.existingDups.keys()].filter((k) => !analysis.inFileDups.has(k)).length };
  }, [analysis]);

  function runImport() {
    if (!analysis) return;
    setError(null);
    setProgress(0);
    startTransition(async () => {
      const out: FileResult[] = [];
      const total = analysis.perFile.reduce((s, f) => s + f.valid.length, 0) || 1;
      let done = 0;
      for (const pf of analysis.perFile) {
        const rows = pf.valid.filter((r) => !analysis.inFileDups.has(key(pf.file.name, r._line)));
        const agg: FileResult = { file: pf.file.name, importId: "", inserted: 0, updated: 0, skipped: 0, invalid: pf.invalid.length, errors: [] };
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK);
          const res = await importLeads({
            fileName: pf.file.name,
            pipelineId,
            mode,
            segmentName: pf.file.segment.trim() || null,
            rows: source === "prospector" ? chunk.map((r) => ({ ...r, source: PROSPECTOR_SOURCE })) : chunk,
          });
          if (!res.ok) {
            setError(`${pf.file.name}: ${res.message}`);
            setResults(out.length ? out : null);
            return;
          }
          agg.importId ||= res.data.import_id;
          agg.inserted += res.data.inserted;
          agg.updated += res.data.updated;
          agg.skipped += res.data.skipped;
          agg.invalid += res.data.invalid;
          agg.errors.push(...res.data.errors);
          done += chunk.length;
          setProgress(Math.round((done / total) * 100));
        }
        agg.skipped += pf.valid.length - rows.length; // duplicados dentro dos arquivos
        out.push(agg);
      }
      setResults(out);
      setStep(4);
      router.refresh();
    });
  }

  function downloadRejected() {
    if (!analysis) return;
    const rows = analysis.perFile.flatMap((pf) => [
      ...pf.invalid.map((r) => ({ arquivo: pf.file.name, linha: r.line, motivo: r.errors.map((e) => e.message).join("; "), ...r.raw })),
      ...pf.valid
        .filter((r) => analysis.inFileDups.has(key(pf.file.name, r._line)))
        .map((r) => {
          const d = analysis.inFileDups.get(key(pf.file.name, r._line))!;
          return { arquivo: pf.file.name, linha: r._line, motivo: `Duplicado (${d.reason}) da linha ${d.withLine} de ${d.withName ?? pf.file.name}`, nome: r.name };
        }),
    ]);
    const csv = Papa.unparse(rows, { delimiter: ";" });
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "linhas-nao-importadas.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setFiles([]);
    setMapping({});
    setAnalysis(null);
    setResults(null);
    setError(null);
    setStep(0);
  }

  return (
    <div className="grid gap-6">
      <ol className="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="Etapas da importação">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={cn("flex items-center gap-2", i === step ? "font-semibold text-foreground" : "text-muted-foreground")}>
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full border text-xs tabular",
                i < step && "border-primary bg-primary text-primary-foreground",
                i === step && "border-primary text-primary",
              )}
              aria-hidden="true"
            >
              {i < step ? "✓" : i + 1}
            </span>
            {i === 0 && source === "prospector" ? "Prospecção" : s}
          </li>
        ))}
      </ol>

      <FormAlert>{error}</FormAlert>

      {step === 0 && source === "prospector" && <ProspectorPanel onFiles={onFiles} pipelines={pipelines} added={prospector?.added ?? {}} segments={prospector?.segments ?? []} />}

      {step === 0 && source === "file" && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void onFiles(e.dataTransfer.files);
          }}
          className={cn("grid place-items-center gap-3 rounded-xl border-2 border-dashed bg-surface px-6 py-12 text-center", dragOver && "border-primary bg-accent")}
        >
          <FileSpreadsheet className="size-8 text-muted-foreground" aria-hidden="true" />
          <div className="grid gap-1">
            <p className="font-medium">Arraste as planilhas aqui</p>
            <p className="text-sm text-muted-foreground">CSV ou XLSX, até 10 MB e 10.000 linhas por arquivo. Pode selecionar vários arquivos com as mesmas colunas.</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            multiple
            className="sr-only"
            id="import-file"
            onChange={(e) => e.target.files && void onFiles(e.target.files)}
          />
          <Button onClick={() => inputRef.current?.click()}>
            <Upload aria-hidden="true" /> Escolher arquivos
          </Button>
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-6">
          <section className="grid gap-3" aria-labelledby="arquivos-sel">
            <h2 id="arquivos-sel" className="text-sm font-semibold">
              Arquivos e segmentos
            </h2>
            <ul className="grid gap-2">
              {files.map((f, i) => (
                <li key={f.name} className="grid items-center gap-2 rounded-lg border bg-surface p-3 sm:grid-cols-[1fr_16rem_auto]">
                  <span className="min-w-0 truncate text-sm">
                    <span className="font-medium">{f.name}</span> · {f.rows.length} linha(s)
                  </span>
                  <div className="grid gap-1">
                    <Label htmlFor={`seg-${i}`} className="text-xs">
                      Segmento dos leads
                    </Label>
                    <Input
                      id={`seg-${i}`}
                      value={f.segment}
                      maxLength={80}
                      onChange={(e) => setFiles((prev) => prev.map((p, j) => (j === i ? { ...p, segment: e.target.value } : p)))}
                    />
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label={`Remover ${f.name}`} onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                    <X aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
            {pipelines.length > 1 && (
              <div className="grid max-w-xs gap-1.5">
                <Label htmlFor="imp-pipeline">Entrar no funil</Label>
                <Select value={pipelineId} onValueChange={setPipelineId}>
                  <SelectTrigger id="imp-pipeline">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </section>

          <section className="grid gap-3" aria-labelledby="mapa">
            <div>
              <h2 id="mapa" className="text-sm font-semibold">
                Correspondência das colunas
              </h2>
              <p className="text-sm text-muted-foreground">Sugerimos pela semelhança dos nomes. Revise e ajuste; o sistema lembra este layout.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {LEAD_FIELDS.map((f) => (
                <div key={f.key} className="grid gap-1">
                  <Label htmlFor={`map-${f.key}`} className="text-xs">
                    {f.label}
                    {"required" in f && f.required ? " (obrigatório)" : ""}
                  </Label>
                  <Select
                    value={mapping[f.key as LeadFieldKey] ?? IGNORE}
                    onValueChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === IGNORE ? undefined : v }))}
                  >
                    <SelectTrigger id={`map-${f.key}`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={IGNORE}>Não importar</SelectItem>
                      {headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-2" aria-labelledby="previa">
            <h2 id="previa" className="text-sm font-semibold">
              Pré-visualização ({Math.min(20, files[0]?.rows.length ?? 0)} primeiras linhas de {files[0]?.name})
            </h2>
            <div className="max-h-80 overflow-auto rounded-lg border bg-surface">
              <Table>
                <TableHeader>
                  <TableRow>
                    {headers.map((h) => (
                      <TableHead key={h} className="whitespace-nowrap">
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sample.map((r, i) => (
                    <TableRow key={i}>
                      {headers.map((h) => (
                        <TableCell key={h} className="max-w-56 truncate">
                          {r[h]}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={reset}>
              Voltar
            </Button>
            <Button onClick={analyze} disabled={pending || files.length === 0}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Validar dados
            </Button>
          </div>
        </div>
      )}

      {step === 2 && analysis && totals && (
        <div className="grid gap-6">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Linhas válidas" value={totals.valid} tone="success" />
            <Stat label="Inválidas" value={totals.invalid} tone={totals.invalid ? "danger" : undefined} />
            <Stat label="Repetidas nos arquivos" value={totals.inFile} tone={totals.inFile ? "warning" : undefined} />
            <Stat label="Já existem no sistema" value={totals.existing} tone={totals.existing ? "warning" : undefined} />
          </dl>

          {totals.existing > 0 && (
            <fieldset className="grid gap-2 rounded-lg border bg-surface p-4">
              <legend className="px-1 text-sm font-semibold">O que fazer com leads que já existem?</legend>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as "skip" | "update")}>
                <label className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value="skip" className="mt-0.5" /> <span>Ignorar (recomendado) — mantém o cadastro atual sem mudanças.</span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value="update" className="mt-0.5" /> <span>Completar — preenche só os campos que estão vazios no cadastro atual.</span>
                </label>
              </RadioGroup>
            </fieldset>
          )}

          {(totals.invalid > 0 || totals.inFile > 0 || totals.existing > 0) && (
            <section aria-labelledby="problemas" className="grid gap-2">
              <h2 id="problemas" className="text-sm font-semibold">
                Detalhes
              </h2>
              <div className="max-h-80 overflow-auto rounded-lg border bg-surface">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Arquivo</TableHead>
                      <TableHead>Linha</TableHead>
                      <TableHead>Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analysis.perFile.flatMap((pf) => [
                      ...pf.invalid.map((r) => (
                        <TableRow key={`i-${pf.file.name}-${r.line}`}>
                          <TableCell>{pf.file.name}</TableCell>
                          <TableCell className="tabular">{r.line}</TableCell>
                          <TableCell className="text-danger">Inválida: {r.errors.map((e) => e.message).join("; ")}</TableCell>
                        </TableRow>
                      )),
                      ...pf.valid
                        .filter((r) => analysis.inFileDups.has(key(pf.file.name, r._line)) || analysis.existingDups.has(key(pf.file.name, r._line)))
                        .map((r) => {
                          const inFile = analysis.inFileDups.get(key(pf.file.name, r._line));
                          const ex = analysis.existingDups.get(key(pf.file.name, r._line));
                          return (
                            <TableRow key={`d-${pf.file.name}-${r._line}`}>
                              <TableCell>{pf.file.name}</TableCell>
                              <TableCell className="tabular">{r._line}</TableCell>
                              <TableCell className="text-warning">
                                {inFile
                                  ? `${r.name}: repetido (${inFile.reason}) da linha ${inFile.withLine}${inFile.withName && inFile.withName !== pf.file.name ? ` de ${inFile.withName}` : ""} — não será importado`
                                  : `${r.name}: já existe como “${ex?.withName}” (${ex?.reason}) — ${mode === "skip" ? "será ignorado" : "campos vazios serão completados"}`}
                              </TableCell>
                            </TableRow>
                          );
                        }),
                    ])}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setStep(1)}>
              Voltar
            </Button>
            {(totals.invalid > 0 || totals.inFile > 0) && (
              <Button variant="outline" onClick={downloadRejected}>
                <Download aria-hidden="true" /> Baixar linhas não importadas
              </Button>
            )}
            <Button onClick={() => setStep(3)} disabled={totals.toSend <= 0}>
              Continuar
            </Button>
          </div>
        </div>
      )}

      {step === 3 && analysis && totals && (
        <div className="grid max-w-xl gap-4">
          <p className="text-sm">
            Vamos importar <strong className="tabular">{Math.max(0, totals.newOnes)}</strong> lead(s) novo(s)
            {totals.existing > 0 && (mode === "skip" ? `, ignorando ${totals.existing} que já existem` : `, completando ${totals.existing} existentes`)}. Cada novo lead entra na primeira etapa do funil
            “{pipelines.find((p) => p.id === pipelineId)?.name}”.
          </p>
          <ul className="grid gap-1 text-sm text-muted-foreground">
            {analysis.perFile.map((pf) => (
              <li key={pf.file.name}>
                {pf.file.name}: segmento “{pf.file.segment || "sem segmento"}”
              </li>
            ))}
          </ul>
          {pending && (
            <div className="grid gap-1" role="status">
              <Progress value={progress} aria-label="Progresso da importação" />
              <span className="text-xs text-muted-foreground">{progress}% concluído</span>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setStep(2)} disabled={pending}>
              Voltar
            </Button>
            <Button onClick={runImport} disabled={pending}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Importar leads
            </Button>
          </div>
        </div>
      )}

      {step === 4 && results && (
        <div className="grid gap-4">
          <div className="flex items-center gap-2 text-success" role="status">
            <CheckCircle2 className="size-5" aria-hidden="true" />
            <p className="font-medium">Importação concluída: {results.reduce((s, r) => s + r.inserted, 0)} lead(s) novo(s).</p>
          </div>
          <div className="overflow-x-auto rounded-lg border bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arquivo</TableHead>
                  <TableHead className="text-right">Novos</TableHead>
                  <TableHead className="text-right">Completados</TableHead>
                  <TableHead className="text-right">Ignorados</TableHead>
                  <TableHead className="text-right">Com erro</TableHead>
                  <TableHead>
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r) => (
                  <TableRow key={r.file}>
                    <TableCell>{r.file}</TableCell>
                    <TableCell className="text-right">{r.inserted}</TableCell>
                    <TableCell className="text-right">{r.updated}</TableCell>
                    <TableCell className="text-right">{r.skipped}</TableCell>
                    <TableCell className="text-right">{r.invalid}</TableCell>
                    <TableCell className="text-right">
                      {r.importId && r.inserted > 0 && <UndoButton importId={r.importId} />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {results.some((r) => r.errors.length) && (
            <div className="grid gap-1 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm">
              <p className="flex items-center gap-2 font-medium text-danger">
                <AlertTriangle className="size-4" aria-hidden="true" /> Linhas recusadas pelo banco
              </p>
              <ul className="list-inside list-disc">
                {results.flatMap((r) => r.errors.map((e) => <li key={`${r.file}-${e.linha}`}>{`${r.file}, linha ${e.linha}: ${e.erro}`}</li>))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/crm/funil">Ver no funil</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/crm/leads">Ver lista de leads</Link>
            </Button>
            <Button variant="ghost" onClick={reset}>
              Importar outro arquivo
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "success" | "danger" | "warning" }) {
  return (
    <div className="rounded-lg border bg-surface p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("tabular text-2xl font-semibold", tone === "success" && "text-success", tone === "danger" && "text-danger", tone === "warning" && "text-warning")}>
        {value.toLocaleString("pt-BR")}
      </dd>
    </div>
  );
}

export function UndoButton({ importId, label = "Desfazer" }: { importId: string; label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await undoImport({ id: importId });
          if (res.ok) {
            toast.success(res.message);
            router.refresh();
          } else toast.error(res.message);
        })
      }
    >
      <Undo2 aria-hidden="true" /> {label}
    </Button>
  );
}
