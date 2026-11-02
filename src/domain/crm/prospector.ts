import Papa from "papaparse";
import { findDuplicatesInFile, suggestMapping, validateRow, type ImportRow, type ValidatedRow } from "./import";

export const PROSPECTOR_SOURCE = "Prospectador";

type SearchInfo = { id: string; parametros: { nichos: string[]; cidade: string; uf: string } };

/** Nome gravado no histórico. Termina no ID da busca, que marca a busca como já enviada ao CRM. */
export function prospectorFileName({ id, parametros: p }: SearchInfo): string {
  const label = `${p.nichos.join(", ")} - ${p.cidade} ${p.uf}`.replace(/[^\p{L}\p{N} ,-]/gu, "").slice(0, 120);
  return `${PROSPECTOR_SOURCE} ${label} #${id}.csv`;
}

export function searchIdFromFileName(fileName: string): string | null {
  return fileName.match(/#([a-f0-9]{32})\.csv$/)?.[1] ?? null;
}

/** Segmento dos leads: é o filtro usado para analisar a busca na lista de leads. */
export function prospectorSegment(nichos: string[]): string {
  return nichos.join(", ").slice(0, 80).trim();
}

/** Aplica ao CSV do conector as mesmas regras do importador de planilhas. */
export function prepareProspectorRows(csv: string): { rows: (ImportRow & { source: string })[]; invalid: number; duplicates: number } {
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  const mapping = suggestMapping(parsed.meta.fields ?? []);
  const validated = parsed.data.map((raw, i) => validateRow(raw, mapping, i + 2));
  const valid = validated.filter((v): v is Extract<ValidatedRow, { ok: true }> => v.ok).map((v) => v.row);
  const duplicated = findDuplicatesInFile(valid);
  return {
    rows: valid.filter((r) => !duplicated.has(r._line)).map((r) => ({ ...r, source: PROSPECTOR_SOURCE })),
    invalid: validated.length - valid.length,
    duplicates: duplicated.size,
  };
}
