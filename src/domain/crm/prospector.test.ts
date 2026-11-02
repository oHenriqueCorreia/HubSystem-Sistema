import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { findDuplicatesInFile, matchExisting, suggestMapping, validateRow } from "./import";
import { prepareProspectorRows, prospectorFileName, prospectorSegment, searchIdFromFileName } from "./prospector";

describe("adicionar busca do prospectador ao CRM", () => {
  const id = "cc2af3c800314d5cb982df11f854b796";

  it("prepara as linhas com origem e sem duplicados nem inválidas", () => {
    const csv = "﻿Empresa;place_id;Telefone\r\nClínica A;ChIJa;(18) 98825-2415\r\nClínica A de novo;ChIJa;\r\n;ChIJb;\r\nClínica C;ChIJc;";
    const { rows, invalid, duplicates } = prepareProspectorRows(csv);
    expect(rows.map((r) => r.name)).toEqual(["Clínica A", "Clínica C"]);
    expect(rows[0]).toMatchObject({ place_id: "ChIJa", source: "Prospectador", phone_e164: "+5518988252415" });
    expect(invalid).toBe(1);
    expect(duplicates).toBe(1);
  });

  it("recupera a busca pelo nome gravado no histórico", () => {
    const name = prospectorFileName({ id, parametros: { nichos: ["pet shops", "clínicas/vet"], cidade: "Araçatuba", uf: "SP" } });
    expect(name).toBe(`Prospectador pet shops, clínicasvet - Araçatuba SP #${id}.csv`);
    expect(searchIdFromFileName(name)).toBe(id);
    expect(searchIdFromFileName("planilha #1.csv")).toBeNull();
  });

  it("limita o nome do segmento", () => {
    expect(prospectorSegment(["a".repeat(100)])).toHaveLength(80);
  });
});

describe("importação direta do prospectador", () => {
  it("preserva o ID mesmo sem link, nota decimal e identificação de duplicados", () => {
    const csv = 'Empresa;place_id;Nota;Avaliações;E-mail;Anotações\r\nClínica;ChIJexample;4,8;123;contato@example.com;Encontrada pelo prospectador';
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });
    const result = validateRow(parsed.data[0], suggestMapping(parsed.meta.fields!), 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row).toMatchObject({ place_id: "ChIJexample", gmb_rating: 4.8, gmb_reviews_count: 123 });
    expect(findDuplicatesInFile([result.row, { ...result.row, _line: 3 }]).get(3)?.reason).toBe("place_id");
    expect(matchExisting([result.row], [{ id: "existing", name: "Clínica", place_id: "ChIJexample", phone_e164: null, email: null }]).get(2)?.withLeadId).toBe("existing");
  });
});
