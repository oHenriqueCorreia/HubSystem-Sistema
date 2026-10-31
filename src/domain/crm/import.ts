import { normalizePhone } from "@/domain/shared/phone";

// Campos do lead que podem vir de uma planilha.
export const LEAD_FIELDS = [
  { key: "name", label: "Nome / Empresa", required: true, aliases: ["empresa", "nome", "name", "razao social", "nome fantasia", "title"] },
  { key: "company_name", label: "Razão social", aliases: ["razao social", "company"] },
  { key: "phone", label: "Telefone", aliases: ["telefone", "phone", "fone", "celular", "tel"] },
  { key: "phone_type", label: "Tipo de telefone", aliases: ["tipo de telefone", "phone type"] },
  { key: "whatsapp", label: "WhatsApp", aliases: ["whatsapp", "whats", "zap"] },
  { key: "email", label: "E-mail", aliases: ["e-mail", "email", "mail"] },
  { key: "website", label: "Site", aliases: ["site", "website", "url", "web"] },
  { key: "instagram", label: "Instagram", aliases: ["instagram", "insta"] },
  { key: "facebook", label: "Facebook", aliases: ["facebook"] },
  { key: "linkedin", label: "LinkedIn", aliases: ["linkedin"] },
  { key: "address", label: "Endereço", aliases: ["endereco", "address", "logradouro"] },
  { key: "neighborhood", label: "Bairro", aliases: ["bairro", "neighborhood"] },
  { key: "city", label: "Cidade", aliases: ["cidade", "city", "municipio"] },
  { key: "state", label: "UF", aliases: ["uf", "estado", "state"] },
  { key: "zip", label: "CEP", aliases: ["cep", "zip", "postal code"] },
  { key: "gmb_rating", label: "Nota no Google", aliases: ["nota", "rating", "avaliacao media"] },
  { key: "gmb_reviews_count", label: "Nº de avaliações", aliases: ["avaliacoes", "reviews", "numero de avaliacoes"] },
  { key: "gmb_url", label: "Link do Google Maps", aliases: ["google maps", "maps", "link maps", "url maps", "google meu negocio"] },
  { key: "category", label: "Categoria", aliases: ["categoria", "category", "segmento", "nicho"] },
  { key: "notes", label: "Observações", aliases: ["anotacoes", "observacoes", "notas", "notes", "obs"] },
] as const;

export type LeadFieldKey = (typeof LEAD_FIELDS)[number]["key"];
export type ColumnMapping = Partial<Record<LeadFieldKey, string>>; // campo → cabeçalho do arquivo

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB",
  "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export function normalizeHeader(h: string): string {
  return h
    .replace(/^﻿/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .trim();
}

/** Sugere o mapeamento campo → coluna pelos nomes dos cabeçalhos. */
export function suggestMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  const normalized = headers.map((h) => ({ raw: h, n: normalizeHeader(h) }));

  for (const field of LEAD_FIELDS) {
    // Primeiro, correspondência exata; depois, "contém".
    const exact = normalized.find((h) => !used.has(h.raw) && field.aliases.some((a) => h.n === a));
    const partial =
      exact ?? normalized.find((h) => !used.has(h.raw) && field.aliases.some((a) => h.n.includes(a) && a.length > 3));
    if (partial) {
      mapping[field.key] = partial.raw;
      used.add(partial.raw);
    }
  }
  // "Empresa" no Google Maps é o nome de exibição; não duplicar em razão social.
  if (mapping.company_name && mapping.company_name === mapping.name) delete mapping.company_name;
  return mapping;
}

/** Assinatura do layout (para lembrar o mapeamento de arquivos com as mesmas colunas). */
export function headerSignature(headers: string[]): string {
  return headers.map(normalizeHeader).join("|");
}

/** Extrai place_id e coordenadas de um link do Google Maps. */
export function parseMapsUrl(url: string | undefined | null): { placeId?: string; lat?: number; lng?: number } {
  if (!url) return {};
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    /* mantém original */
  }
  const placeId = decoded.match(/!19s(ChIJ[\w-]+)/)?.[1] ?? decoded.match(/place_id[:=](ChIJ[\w-]+)/)?.[1];
  const coords = decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  return {
    placeId,
    lat: coords ? Number(coords[1]) : undefined,
    lng: coords ? Number(coords[2]) : undefined,
  };
}

/** "Nicho-Esquadrias-de-Aluminio.csv" → "Esquadrias de Aluminio" */
export function segmentFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/^nicho[-_\s]*/i, "");
  const words = base.split(/[-_\s]+/).filter(Boolean);
  const small = new Set(["de", "da", "do", "das", "dos", "e"]);
  return words
    .map((w, i) => (i > 0 && small.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

export type ImportRow = {
  _line: number;
  name: string;
  company_name: string | null;
  phone_raw: string | null;
  phone_e164: string | null;
  phone_type: "celular" | "fixo" | "desconhecido" | null;
  whatsapp_e164: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  place_id: string | null;
  gmb_url: string | null;
  gmb_rating: number | null;
  gmb_reviews_count: number | null;
  notes: string | null;
  category: string | null;
};

export type RowIssue = { field: string; message: string };
export type ValidatedRow =
  | { line: number; ok: true; row: ImportRow; warnings: RowIssue[] }
  | { line: number; ok: false; errors: RowIssue[]; raw: Record<string, string> };

const clean = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function normalizeUrl(v: string | null): string | null {
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+/.test(v)) return `https://${v}`;
  return v;
}

function parseNumberBR(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Valida e normaliza uma linha da planilha conforme o mapeamento escolhido. */
export function validateRow(raw: Record<string, string>, mapping: ColumnMapping, line: number): ValidatedRow {
  const get = (k: LeadFieldKey) => clean(mapping[k] ? raw[mapping[k]!] : null);
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];

  const name = get("name");
  if (!name) errors.push({ field: "name", message: "Nome em branco" });
  else if (name.length > 160) errors.push({ field: "name", message: "Nome com mais de 160 caracteres" });

  const phoneRaw = get("phone");
  const phone = normalizePhone(phoneRaw);
  if (phoneRaw && !phone) warnings.push({ field: "phone", message: `Telefone inválido: ${phoneRaw}` });

  const whatsRaw = get("whatsapp");
  const whats = normalizePhone(whatsRaw);

  let email = get("email")?.toLowerCase() ?? null;
  if (email && !EMAIL_RE.test(email)) {
    warnings.push({ field: "email", message: `E-mail inválido ignorado: ${email}` });
    email = null;
  }

  let state = get("state")?.toUpperCase() ?? null;
  if (state && !(UFS as readonly string[]).includes(state)) {
    warnings.push({ field: "state", message: `UF desconhecida ignorada: ${state}` });
    state = null;
  }

  let zip = get("zip");
  if (zip) {
    const digits = zip.replace(/\D/g, "");
    zip = digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : null;
    if (!zip) warnings.push({ field: "zip", message: "CEP inválido ignorado" });
  }

  const rating = parseNumberBR(get("gmb_rating"));
  const reviews = parseNumberBR(get("gmb_reviews_count"));
  const gmbUrl = get("gmb_url");
  const maps = parseMapsUrl(gmbUrl);

  if (!phone && !email && !whats) {
    warnings.push({ field: "phone", message: "Sem telefone nem e-mail válidos" });
  }

  if (errors.length) return { line, ok: false, errors, raw };

  const phoneTypeRaw = get("phone_type")?.toLowerCase();
  const phoneType =
    phoneTypeRaw === "celular" || phoneTypeRaw === "fixo" ? phoneTypeRaw : (phone?.type ?? null);

  return {
    line,
    ok: true,
    warnings,
    row: {
      _line: line,
      name: name!,
      company_name: get("company_name"),
      phone_raw: phoneRaw,
      phone_e164: phone?.e164 ?? null,
      phone_type: phone ? phoneType : null,
      // Celular sem coluna de WhatsApp: assume o mesmo número (o botão abre wa.me).
      whatsapp_e164: whats?.e164 ?? (phone?.type === "celular" ? phone.e164 : null),
      email,
      website: normalizeUrl(get("website")),
      instagram: get("instagram"),
      facebook: get("facebook"),
      linkedin: get("linkedin"),
      address: get("address"),
      neighborhood: get("neighborhood"),
      city: get("city"),
      state,
      zip,
      lat: maps.lat ?? null,
      lng: maps.lng ?? null,
      place_id: maps.placeId ?? null,
      gmb_url: gmbUrl,
      gmb_rating: rating !== null && rating >= 0 && rating <= 5 ? Math.round(rating * 10) / 10 : null,
      gmb_reviews_count: reviews !== null && reviews >= 0 ? Math.round(reviews) : null,
      notes: get("notes"),
      category: get("category"),
    },
  };
}

export type DuplicateInfo = { line: number; reason: "place_id" | "telefone" | "e-mail"; withLine?: number; withLeadId?: string; withName?: string };

/** Duplicados dentro do próprio arquivo (a primeira ocorrência vence). */
export function findDuplicatesInFile(rows: ImportRow[]): Map<number, DuplicateInfo> {
  const seen = { place: new Map<string, number>(), phone: new Map<string, number>(), email: new Map<string, number>() };
  const dups = new Map<number, DuplicateInfo>();
  for (const r of rows) {
    const hit =
      (r.place_id && seen.place.has(r.place_id) && { reason: "place_id" as const, withLine: seen.place.get(r.place_id) }) ||
      (r.phone_e164 && seen.phone.has(r.phone_e164) && { reason: "telefone" as const, withLine: seen.phone.get(r.phone_e164) }) ||
      (r.email && seen.email.has(r.email) && { reason: "e-mail" as const, withLine: seen.email.get(r.email) });
    if (hit) {
      dups.set(r._line, { line: r._line, ...hit });
      continue;
    }
    if (r.place_id) seen.place.set(r.place_id, r._line);
    if (r.phone_e164) seen.phone.set(r.phone_e164, r._line);
    if (r.email) seen.email.set(r.email, r._line);
  }
  return dups;
}

/** Duplicados contra leads já existentes no banco. */
export function matchExisting(
  rows: ImportRow[],
  existing: { id: string; name: string; place_id: string | null; phone_e164: string | null; email: string | null }[],
): Map<number, DuplicateInfo> {
  const byPlace = new Map(existing.filter((e) => e.place_id).map((e) => [e.place_id!, e]));
  const byPhone = new Map(existing.filter((e) => e.phone_e164).map((e) => [e.phone_e164!, e]));
  const byEmail = new Map(existing.filter((e) => e.email).map((e) => [e.email!.toLowerCase(), e]));
  const out = new Map<number, DuplicateInfo>();
  for (const r of rows) {
    const match =
      (r.place_id && byPlace.get(r.place_id) && { reason: "place_id" as const, e: byPlace.get(r.place_id)! }) ||
      (r.phone_e164 && byPhone.get(r.phone_e164) && { reason: "telefone" as const, e: byPhone.get(r.phone_e164)! }) ||
      (r.email && byEmail.get(r.email) && { reason: "e-mail" as const, e: byEmail.get(r.email)! });
    if (match) out.set(r._line, { line: r._line, reason: match.reason, withLeadId: match.e.id, withName: match.e.name });
  }
  return out;
}
