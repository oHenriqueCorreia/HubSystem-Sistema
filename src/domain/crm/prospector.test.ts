import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { findDuplicatesInFile, matchExisting, suggestMapping, validateRow } from "./import";

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
