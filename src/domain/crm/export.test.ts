import { describe, expect, it } from "vitest";
import { csvCell, csvLine } from "./export";

describe("exportação CSV de leads", () => {
  it("preserva separadores, aspas e quebras de linha", () => {
    expect(csvLine(['Ana; "Silva"\r\nComércio', null])).toBe('"Ana; ""Silva""\nComércio";""\r\n');
  });

  it("neutraliza fórmulas de planilhas em dados importados", () => {
    for (const value of ["=HYPERLINK(\"x\")", "+SUM(1,2)", "-1+2", "@SUM(1)", "  =1+1"]) {
      expect(csvCell(value)).toBe(`"'${value.replaceAll('"', '""')}"`);
    }
  });
});
