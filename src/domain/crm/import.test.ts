import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import {
  findDuplicatesInFile,
  matchExisting,
  parseMapsUrl,
  segmentFromFileName,
  suggestMapping,
  validateRow,
  type ImportRow,
} from "./import";

const HEADERS = [
  "Empresa", "Categoria", "Telefone", "Tipo de telefone", "WhatsApp", "Link WhatsApp", "E-mail", "Site",
  "Instagram", "Facebook", "LinkedIn", "Endereço", "Bairro", "Cidade", "UF", "CEP", "Nota", "Avaliações",
  "Google Maps", "Status", "Anotações",
];

const MAPS =
  "https://www.google.com/maps/place/Val+Box/data=!4m7!3m6!1s0x94ce43f37fc2cbb1:0xe35e9daaa833e4a2!8m2!3d-23.7061733!4d-46.5883317!16s%2Fg%2F1wyc5g0q!19sChIJscvCf_NDzpQRouQzqKqdXuM?authuser=0";

describe("mapeamento de colunas", () => {
  it("reconhece o layout exportado do Google Maps", () => {
    const m = suggestMapping(HEADERS);
    expect(m).toMatchObject({
      name: "Empresa",
      category: "Categoria",
      phone: "Telefone",
      phone_type: "Tipo de telefone",
      whatsapp: "WhatsApp",
      email: "E-mail",
      website: "Site",
      address: "Endereço",
      neighborhood: "Bairro",
      city: "Cidade",
      state: "UF",
      zip: "CEP",
      gmb_rating: "Nota",
      gmb_reviews_count: "Avaliações",
      gmb_url: "Google Maps",
      notes: "Anotações",
    });
  });
});

describe("link do Google Maps", () => {
  it("extrai place_id e coordenadas", () => {
    expect(parseMapsUrl(MAPS)).toEqual({ placeId: "ChIJscvCf_NDzpQRouQzqKqdXuM", lat: -23.7061733, lng: -46.5883317 });
    expect(parseMapsUrl("")).toEqual({});
  });
});

describe("segmento pelo nome do arquivo", () => {
  it("gera um nome legível", () => {
    expect(segmentFromFileName("Nicho-Esquadrias-de-Aluminio.csv")).toBe("Esquadrias de Aluminio");
    expect(segmentFromFileName("Nicho-Vidracaria.csv")).toBe("Vidracaria");
  });
});

describe("validação de linha", () => {
  const mapping = suggestMapping(HEADERS);
  const base = Object.fromEntries(HEADERS.map((h) => [h, ""])) as Record<string, string>;

  it("normaliza uma linha válida", () => {
    const res = validateRow(
      { ...base, Empresa: "Val Box", Telefone: "(11) 99272-2188", Cidade: "São Bernardo do Campo", UF: "sp", CEP: "09850300", Nota: "4,8", Avaliações: "251", "Google Maps": MAPS },
      mapping,
      2,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.row).toMatchObject({
      name: "Val Box",
      phone_e164: "+5511992722188",
      whatsapp_e164: "+5511992722188",
      phone_type: "celular",
      state: "SP",
      zip: "09850-300",
      gmb_rating: 4.8,
      gmb_reviews_count: 251,
      place_id: "ChIJscvCf_NDzpQRouQzqKqdXuM",
    });
  });

  it("rejeita linha sem nome", () => {
    const res = validateRow({ ...base, Telefone: "(11) 99272-2188" }, mapping, 3);
    expect(res.ok).toBe(false);
  });

  it("aceita com aviso quando dados secundários são inválidos", () => {
    const res = validateRow({ ...base, Empresa: "X", "E-mail": "nao-e-email", UF: "ZZ" }, mapping, 4);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.row.email).toBeNull();
      expect(res.row.state).toBeNull();
      expect(res.warnings.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("duplicados", () => {
  const row = (line: number, p: Partial<ImportRow>) => ({ _line: line, name: `L${line}`, place_id: null, phone_e164: null, email: null, ...p }) as ImportRow;

  it("detecta duplicados no arquivo; a primeira ocorrência vence", () => {
    const d = findDuplicatesInFile([
      row(2, { place_id: "A", phone_e164: "+5511999990000" }),
      row(3, { place_id: "A" }),
      row(4, { phone_e164: "+5511999990000" }),
      row(5, { place_id: "B" }),
    ]);
    expect([...d.keys()]).toEqual([3, 4]);
    expect(d.get(3)).toMatchObject({ reason: "place_id", withLine: 2 });
    expect(d.get(4)).toMatchObject({ reason: "telefone", withLine: 2 });
  });

  it("detecta duplicados contra o banco", () => {
    const d = matchExisting([row(2, { email: "a@b.com" })], [{ id: "x", name: "Antigo", place_id: null, phone_e164: null, email: "A@b.com" }]);
    expect(d.get(2)).toMatchObject({ reason: "e-mail", withLeadId: "x" });
  });
});

// Usa as planilhas reais da pasta "csv leads" quando existirem (não versionadas).
const DIR = join(process.cwd(), "csv leads");
describe.skipIf(!existsSync(DIR))("planilhas reais", () => {
  it("processa todas as linhas e encontra os duplicados esperados", () => {
    const all: ImportRow[] = [];
    let invalid = 0;
    for (const file of readdirSync(DIR).filter((f) => f.endsWith(".csv"))) {
      const text = readFileSync(join(DIR, file), "utf8");
      const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: true });
      const mapping = suggestMapping(parsed.meta.fields ?? []);
      expect(mapping.name).toBe("Empresa");
      parsed.data.forEach((raw, i) => {
        const v = validateRow(raw, mapping, i + 2);
        if (v.ok) all.push({ ...v.row, _line: all.length + 2 });
        else invalid++;
      });
    }
    expect(invalid).toBe(0);
    expect(all.length).toBe(257);
    expect(all.every((r) => r.place_id)).toBe(true);
    expect(all.every((r) => r.phone_e164)).toBe(true);
    const dups = findDuplicatesInFile(all);
    // 3 por place_id + 2 telefones repetidos em empresas diferentes
    expect(dups.size).toBe(5);
  });
});
