/** Leitura de extratos e sugestões da revisão. Nada aqui grava: só transforma texto em linhas. */

export type StatementDirection = "entrada" | "saida";

export type StatementLine = {
  id: string;
  date: string | null;
  description: string;
  amountCents: number;
  direction: StatementDirection;
  /** Linhas de PDF ou de planilha que precisam de conferência. */
  confidence: "alta" | "baixa";
  problem: string | null;
  externalId: string | null;
};

let counter = 0;
const nextId = () => `l${++counter}`;

/** "1.234,56", "-1234.56", "R$ 10,00", "1,234.56" viram centavos com sinal. */
export function parseMoney(raw: string): number | null {
  let s = raw.replace(/[R$\s ]/g, "");
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/^-/.test(s) || /-$/.test(s)) negative = true;
  s = s.replace(/-/g, "").replace(/^\+/, "");
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  let normalized: string;
  if (comma > dot) normalized = s.replace(/\./g, "").replace(",", ".");
  else if (dot > comma && comma !== -1) normalized = s.replace(/,/g, "");
  else if (dot !== -1 && s.length - dot - 1 === 3 && s.split(".").length >= 2 && comma === -1) normalized = s.replace(/\./g, "");
  else normalized = s;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return negative ? -cents : cents;
}

const validDate = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
};

/** dd/mm/aaaa, dd/mm/aa, dd-mm-aaaa, aaaa-mm-dd e serial do Excel. */
export function parseDate(raw: string | number): string | null {
  if (typeof raw === "number") {
    if (raw < 20000 || raw > 80000) return null;
    return new Date(Date.UTC(1899, 11, 30) + raw * 86_400_000).toISOString().slice(0, 10);
  }
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return validDate(year, +m[2], +m[1]);
  }
  return null;
}

const tag = (block: string, name: string) => new RegExp(`<${name}>([^<\\r\\n]*)`, "i").exec(block)?.[1]?.trim() ?? "";

/** OFX 1.x (SGML, sem fechar tags) e 2.x (XML). */
export function parseOfx(text: string): StatementLine[] {
  const blocks = text.match(/<STMTTRN>[\s\S]*?(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi) ?? [];
  return blocks.map((block) => {
    const posted = tag(block, "DTPOSTED");
    const date = /^\d{8}/.test(posted) ? validDate(+posted.slice(0, 4), +posted.slice(4, 6), +posted.slice(6, 8)) : null;
    const cents = parseMoney(tag(block, "TRNAMT"));
    const description = [tag(block, "NAME"), tag(block, "MEMO")].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" - ") || "Sem descrição";
    const problem = !date ? "Data não reconhecida." : cents === null || cents === 0 ? "Valor não reconhecido." : null;
    return { id: nextId(), date, description: description.slice(0, 300), amountCents: Math.abs(cents ?? 0), direction: (cents ?? 0) >= 0 ? "entrada" : "saida", confidence: problem ? "baixa" : "alta", problem, externalId: tag(block, "FITID") || null };
  });
}

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const HEADERS = {
  date: ["data", "data lancamento", "data do lancamento", "data movimento", "data mov", "dt", "date", "lancamento"],
  description: ["descricao", "historico", "descricao do lancamento", "lancamento", "detalhes", "description", "titulo", "memo"],
  amount: ["valor", "valor (r$)", "valor r$", "amount", "quantia"],
  credit: ["credito", "entrada", "entradas", "credito (r$)", "valor credito"],
  debit: ["debito", "saida", "saidas", "debito (r$)", "valor debito"],
  type: ["tipo", "d/c", "dc", "c/d", "natureza"],
};

type Columns = { date: number; description: number; amount: number; credit: number; debit: number; type: number };

function findColumns(row: unknown[]): Columns | null {
  const cells = row.map(norm);
  const find = (names: string[]) => cells.findIndex((c) => names.includes(c));
  let description = find(HEADERS.description);
  const date = cells.findIndex((c, i) => HEADERS.date.includes(c) && i !== description);
  if (description === date) description = cells.findIndex((c, i) => HEADERS.description.includes(c) && i !== date);
  const out = { date, description, amount: find(HEADERS.amount), credit: find(HEADERS.credit), debit: find(HEADERS.debit), type: find(HEADERS.type) };
  return out.date >= 0 && (out.amount >= 0 || out.credit >= 0 || out.debit >= 0) ? out : null;
}

const toCents = (v: unknown) => (typeof v === "number" ? Math.round(v * 100) : parseMoney(String(v ?? "")));

/** CSV ou planilha já em linhas. Procura o cabeçalho, porque bancos põem informações antes dele. */
export function parseTable(rows: unknown[][]): { lines: StatementLine[]; headerFound: boolean } {
  const headerAt = rows.slice(0, 40).findIndex((r) => findColumns(r));
  if (headerAt < 0) return { lines: [], headerFound: false };
  const col = findColumns(rows[headerAt])!;
  const lines: StatementLine[] = [];
  for (const row of rows.slice(headerAt + 1)) {
    if (!row.some((c) => String(c ?? "").trim())) continue;
    const description = String(row[col.description] ?? "").trim();
    if (/saldo/i.test(description) && !/pix|transf/i.test(description)) continue;
    const rawDate = row[col.date];
    const date = typeof rawDate === "number" ? parseDate(rawDate) : parseDate(String(rawDate ?? ""));
    let cents: number | null = null;
    if (col.amount >= 0) {
      cents = toCents(row[col.amount]);
      const kind = col.type >= 0 ? norm(row[col.type]) : "";
      if (cents !== null && /^(d|debito|saida)/.test(kind)) cents = -Math.abs(cents);
      if (cents !== null && /^(c|credito|entrada)/.test(kind)) cents = Math.abs(cents);
    } else {
      const credit = col.credit >= 0 ? toCents(row[col.credit]) : null;
      const debit = col.debit >= 0 ? toCents(row[col.debit]) : null;
      cents = credit ? Math.abs(credit) : debit ? -Math.abs(debit) : null;
    }
    const problem = !date ? "Data não reconhecida." : cents === null || cents === 0 ? "Valor não reconhecido." : null;
    lines.push({ id: nextId(), date, description: (description || "Sem descrição").slice(0, 300), amountCents: Math.abs(cents ?? 0), direction: (cents ?? 0) >= 0 ? "entrada" : "saida", confidence: problem ? "baixa" : "alta", problem, externalId: null });
  }
  return { lines, headerFound: true };
}

const PDF_LINE = /^(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)\s+(.+)$/;
const PDF_AMOUNT = /(?:R\$\s*)?(-?\s?\d{1,3}(?:\.\d{3})*,\d{2}|-?\s?\d+,\d{2})(\s*-)?\s*([CD])?(?:\s+(-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2})\s*[CD]?)?\s*$/i;

/**
 * Texto de PDF: cada banco tem um layout, então só "data no começo e valor no fim"
 * é aceito com confiança. O resto vai para conferência, nunca é descartado em silêncio.
 */
export function parsePdfText(lines: string[], fallbackYear: number): { lines: StatementLine[]; unreadable: number } {
  const out: StatementLine[] = [];
  let unreadable = 0;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    const m = PDF_LINE.exec(line);
    if (!m) continue;
    if (/saldo/i.test(m[2]) && !/pix|transf/i.test(m[2])) continue;
    const parts = m[1].split(/[/.-]/);
    const hasYear = parts.length === 3;
    const date = hasYear ? parseDate(m[1]) : validDate(fallbackYear, +parts[1], +parts[0]);
    const amount = PDF_AMOUNT.exec(m[2]);
    if (!amount) {
      unreadable++;
      out.push({ id: nextId(), date, description: m[2].slice(0, 300), amountCents: 0, direction: "saida", confidence: "baixa", problem: "Valor não encontrado nesta linha do PDF.", externalId: null });
      continue;
    }
    const cents = parseMoney(amount[1].replace(/\s/g, ""));
    const description = m[2].slice(0, amount.index).trim() || "Sem descrição";
    const marker = amount[3]?.toUpperCase();
    const negative = (cents ?? 0) < 0 || Boolean(amount[2]) || marker === "D";
    const signKnown = (cents ?? 0) < 0 || Boolean(amount[2]) || Boolean(marker);
    const problems = [!date && "Data não reconhecida.", !hasYear && `Ano assumido: ${fallbackYear}.`, !signKnown && "Confira se é entrada ou saída.", amount[4] && "A linha tem dois valores: confira qual é o lançamento."].filter(Boolean) as string[];
    out.push({
      id: nextId(),
      date,
      description: description.slice(0, 300),
      amountCents: Math.abs(cents ?? 0),
      direction: negative ? "saida" : "entrada",
      confidence: problems.length ? "baixa" : "alta",
      problem: problems.join(" ") || null,
      externalId: null,
    });
  }
  return { lines: out, unreadable };
}

const hashText = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Mesma linha = mesmo id do banco ou mesma data, valor, sentido e texto. Linhas iguais no mesmo arquivo recebem #2, #3. */
export function lineHashes(lines: Pick<StatementLine, "id" | "date" | "amountCents" | "direction" | "description" | "externalId">[]) {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const l of lines) {
    const base = l.externalId ? `id:${l.externalId}` : `${l.date}|${l.amountCents}|${l.direction}|${hashText(l.description)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.set(l.id, n > 1 ? `${base}#${n}` : base);
  }
  return out;
}

export type MatchTxn = { id: string; scope: "empresa" | "pessoal"; kind: string; description: string; amount_cents: number; paid_amount_cents: number | null; due_date: string; paid_at: string | null; status: string; reconciled_at: string | null };

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;

/** Candidatos para conciliar: mesmo sentido e valor, em até 7 dias. O mais próximo vem primeiro. */
export function matchCandidates(line: Pick<StatementLine, "date" | "amountCents" | "direction">, txns: MatchTxn[]) {
  if (!line.date || !line.amountCents) return [];
  const kind = line.direction === "entrada" ? "receita" : "despesa";
  return txns
    .filter((t) => t.kind === kind && !t.reconciled_at && t.status !== "cancelado" && (t.status === "pago" ? (t.paid_amount_cents ?? t.amount_cents) : t.amount_cents) === line.amountCents)
    .map((t) => ({ t, diff: dayDiff(line.date!, t.paid_at ?? t.due_date) }))
    .filter((x) => x.diff <= 7)
    .sort((a, b) => a.diff - b.diff)
    .map((x) => x.t);
}

/** Já lançado à mão: pago e conciliado, com o mesmo valor em até 2 dias. */
export function likelyDuplicate(line: Pick<StatementLine, "date" | "amountCents" | "direction">, txns: MatchTxn[]) {
  if (!line.date || !line.amountCents) return false;
  const kind = line.direction === "entrada" ? "receita" : "despesa";
  return txns.some((t) => t.kind === kind && t.status === "pago" && t.reconciled_at && (t.paid_amount_cents ?? t.amount_cents) === line.amountCents && dayDiff(line.date!, t.paid_at ?? t.due_date) <= 2);
}

export type CategoryRule = { pattern: string; category_id: string; scope: "empresa" | "pessoal" };

/** A regra mais específica (maior texto) ganha. É só sugestão: a pessoa sempre pode trocar. */
export function suggestRule(description: string, rules: CategoryRule[]) {
  const text = hashText(description);
  return [...rules].sort((a, b) => b.pattern.length - a.pattern.length).find((r) => text.includes(hashText(r.pattern))) ?? null;
}
