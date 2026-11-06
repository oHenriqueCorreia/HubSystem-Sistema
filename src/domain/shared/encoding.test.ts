import { describe, expect, it } from "vitest";
import { decodeTextFile, hasMojibake, repairMojibake } from "./encoding";

const utf8 = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
/** Bytes como o Excel antigo salva (Windows-1252 / ISO-8859-1). */
const cp1252 = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0))).buffer as ArrayBuffer;
/** Texto UTF-8 lido erradamente como Windows-1252 (o defeito real). */
const corrupt = (s: string) => new TextDecoder("windows-1252").decode(new TextEncoder().encode(s));

describe("repairMojibake", () => {
  it("conserta aspas tipográficas (o caso da linha do tempo)", () => {
    expect(repairMojibake("Importado de â€œNicho-Esquadrias.csvâ€\u009d")).toBe("Importado de “Nicho-Esquadrias.csv”");
    expect(repairMojibake(corrupt("Movido de “Contato” para “Proposta”"))).toBe("Movido de “Contato” para “Proposta”");
  });
  it("conserta acentos, cedilha e letras do Windows-1252", () => {
    for (const s of ["Ação", "São Paulo", "Última tentativa", "coração", "Avenida Paulista, nº 1000", "ÁÉÍÓÚ àèìòù âêô ãõ ç Ç"]) {
      expect(repairMojibake(corrupt(s))).toBe(s);
    }
  });
  it("conserta emojis e símbolos", () => {
    for (const s of ["Cliente 😀 aprovou", "Preço € 10 – desconto", "Marca™ “nova”"]) expect(repairMojibake(corrupt(s))).toBe(s);
  });
  it("não mexe em texto correto", () => {
    for (const s of ["SÃO PAULO", "NÃO", "1º lugar", "Ação já feita", "Café ☕", "R$ 1.890,00", "“aspas” ‘simples’", "Â" , "Ã"]) {
      expect(repairMojibake(s)).toBe(s);
      expect(hasMojibake(s)).toBe(false);
    }
  });
  it("é idempotente", () => {
    const once = repairMojibake(corrupt("Atenção: “última” chamada"));
    expect(repairMojibake(once)).toBe(once);
  });
});

describe("decodeTextFile", () => {
  it("lê UTF-8 com e sem BOM", () => {
    expect(decodeTextFile(utf8("nome;cidade\nJoão;São Paulo"))).toBe("nome;cidade\nJoão;São Paulo");
    expect(decodeTextFile(utf8("﻿nome,cidade\nAçaí,Belém"))).toBe("nome,cidade\nAçaí,Belém");
  });
  it("lê Windows-1252 / ISO-8859-1 (Excel antigo)", () => {
    expect(decodeTextFile(cp1252("nome;cidade\nJoão;São Paulo\tCoração"))).toBe("nome;cidade\nJoão;São Paulo\tCoração");
  });
  it("conserta arquivo que já veio corrompido de outro sistema", () => {
    expect(decodeTextFile(utf8(corrupt("empresa,obs\nVidraçaria,“ótima”")))).toBe("empresa,obs\nVidraçaria,“ótima”");
  });
  it("mantém emojis e aspas de planilhas do Google", () => {
    expect(decodeTextFile(utf8('nome,obs\n"Silva, Ana","Gostou 👍 do “site”"'))).toBe('nome,obs\n"Silva, Ana","Gostou 👍 do “site”"');
  });
});
