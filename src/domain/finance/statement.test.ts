import { describe, expect, it } from "vitest";
import { likelyDuplicate, lineHashes, matchCandidates, parseDate, parseMoney, parseOfx, parsePdfText, parseTable, suggestRule, type MatchTxn } from "./statement";

describe("valores e datas", () => {
  it("entende os formatos brasileiro e internacional", () => {
    expect(parseMoney("1.234,56")).toBe(123456);
    expect(parseMoney("-1.234,56")).toBe(-123456);
    expect(parseMoney("R$ 10,00")).toBe(1000);
    expect(parseMoney("1,234.56")).toBe(123456);
    expect(parseMoney("1234.56")).toBe(123456);
    expect(parseMoney("(50,00)")).toBe(-5000);
    expect(parseMoney("50,00-")).toBe(-5000);
    expect(parseMoney("1.000")).toBe(100000);
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });

  it("recusa data impossível", () => {
    expect(parseDate("31/12/2026")).toBe("2026-12-31");
    expect(parseDate("05/11/26")).toBe("2026-11-05");
    expect(parseDate("2026-11-05")).toBe("2026-11-05");
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate(46331)).toBe("2026-11-05");
    expect(parseDate("ontem")).toBeNull();
  });
});

describe("OFX", () => {
  const sgml = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261105120000[-3:BRT]<TRNAMT>-42.90<FITID>A1<MEMO>Mercado
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261106<TRNAMT>1500.00<FITID>A2<NAME>PIX Cliente<MEMO>PIX Cliente
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  it("lê OFX sem fechar tags", () => {
    const lines = parseOfx(sgml);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ date: "2026-11-05", amountCents: 4290, direction: "saida", description: "Mercado", externalId: "A1", confidence: "alta" });
    expect(lines[1]).toMatchObject({ amountCents: 150000, direction: "entrada", description: "PIX Cliente" });
  });

  it("lê OFX em XML", () => {
    const lines = parseOfx("<BANKTRANLIST><STMTTRN><DTPOSTED>20261105</DTPOSTED><TRNAMT>-10.00</TRNAMT><FITID>X</FITID><MEMO>Tarifa</MEMO></STMTTRN></BANKTRANLIST>");
    expect(lines[0]).toMatchObject({ amountCents: 1000, direction: "saida", description: "Tarifa" });
  });
});

describe("CSV e planilha", () => {
  it("acha o cabeçalho depois de linhas do banco e ignora saldo", () => {
    const { lines, headerFound } = parseTable([
      ["Banco Exemplo", ""],
      ["Data", "Histórico", "Valor"],
      ["05/11/2026", "Mercado", "-42,90"],
      ["06/11/2026", "SALDO DO DIA", "1.000,00"],
      ["06/11/2026", "PIX recebido", "1.500,00"],
    ]);
    expect(headerFound).toBe(true);
    expect(lines.map((l) => [l.date, l.amountCents, l.direction])).toEqual([
      ["2026-11-05", 4290, "saida"],
      ["2026-11-06", 150000, "entrada"],
    ]);
  });

  it("entende colunas separadas de crédito e débito", () => {
    const { lines } = parseTable([
      ["Data", "Descrição", "Crédito", "Débito"],
      ["05/11/2026", "Entrada", "100,00", ""],
      ["05/11/2026", "Saída", "", "30,00"],
    ]);
    expect(lines.map((l) => l.direction)).toEqual(["entrada", "saida"]);
  });

  it("marca linha ruim para conferência em vez de descartar", () => {
    const { lines } = parseTable([
      ["Data", "Descrição", "Valor"],
      ["sem data", "Algo", "10,00"],
    ]);
    expect(lines[0]).toMatchObject({ confidence: "baixa", problem: "Data não reconhecida." });
  });

  it("avisa quando não acha o cabeçalho", () => {
    expect(parseTable([["a", "b"]]).headerFound).toBe(false);
  });
});

describe("PDF", () => {
  it("lê data no começo e valor no fim", () => {
    const { lines } = parsePdfText(["05/11/2026 PAGAMENTO BOLETO 1.234,56 D", "06/11/2026 PIX RECEBIDO 500,00 C"], 2026);
    expect(lines[0]).toMatchObject({ date: "2026-11-05", amountCents: 123456, direction: "saida", confidence: "alta" });
    expect(lines[1]).toMatchObject({ direction: "entrada", confidence: "alta" });
  });

  it("sem sinal, sem ano ou com dois valores vai para conferência", () => {
    const { lines } = parsePdfText(["05/11 COMPRA 42,90", "06/11/2026 TED 100,00 D 5.000,00 C"], 2026);
    expect(lines[0].confidence).toBe("baixa");
    expect(lines[0].problem).toContain("Ano assumido");
    expect(lines[1].confidence).toBe("baixa");
    expect(lines[1].amountCents).toBe(10000);
  });

  it("linha com data e sem valor aparece para corrigir; texto comum e saldo ficam de fora", () => {
    const { lines, unreadable } = parsePdfText(["Extrato de conta", "05/11/2026 SALDO ANTERIOR 10,00", "07/11/2026 TEXTO SEM VALOR"], 2026);
    expect(lines).toHaveLength(1);
    expect(unreadable).toBe(1);
    expect(lines[0].amountCents).toBe(0);
  });
});

describe("duplicatas, conciliação e regras", () => {
  const line = { date: "2026-11-05", amountCents: 50000, direction: "entrada" as const };
  const txn = (over: Partial<MatchTxn>): MatchTxn => ({ id: "t", scope: "empresa", kind: "receita", description: "Mensalidade", amount_cents: 50000, paid_amount_cents: null, due_date: "2026-11-03", paid_at: null, status: "previsto", reconciled_at: null, ...over });

  it("linhas iguais no mesmo arquivo não viram a mesma", () => {
    const base = { date: "2026-11-05", amountCents: 100, direction: "saida" as const, description: "Café", externalId: null };
    const out = lineHashes([{ ...base, id: "a" }, { ...base, id: "b" }]);
    expect(out.get("a")).not.toBe(out.get("b"));
  });

  it("o id do banco identifica a linha mesmo com texto diferente", () => {
    const a = lineHashes([{ id: "a", date: "2026-11-05", amountCents: 1, direction: "saida", description: "X", externalId: "F1" }]);
    const b = lineHashes([{ id: "a", date: "2026-11-05", amountCents: 1, direction: "saida", description: "Y", externalId: "F1" }]);
    expect(a.get("a")).toBe(b.get("a"));
  });

  it("sugere a cobrança de mesmo valor e sentido", () => {
    expect(matchCandidates(line, [txn({})]).map((t) => t.id)).toEqual(["t"]);
    expect(matchCandidates(line, [txn({ kind: "despesa" })])).toHaveLength(0);
    expect(matchCandidates(line, [txn({ amount_cents: 49999 })])).toHaveLength(0);
    expect(matchCandidates(line, [txn({ due_date: "2026-09-01" })])).toHaveLength(0);
    expect(matchCandidates(line, [txn({ reconciled_at: "2026-11-05T00:00:00Z" })])).toHaveLength(0);
    expect(matchCandidates(line, [txn({ status: "cancelado" })])).toHaveLength(0);
  });

  it("aponta possível duplicata de lançamento já conciliado", () => {
    expect(likelyDuplicate(line, [txn({ status: "pago", paid_at: "2026-11-05", reconciled_at: "2026-11-05T00:00:00Z" })])).toBe(true);
    expect(likelyDuplicate(line, [txn({})])).toBe(false);
  });

  it("regra mais específica vence e ignora acento", () => {
    const rules = [
      { pattern: "mercado", category_id: "a", scope: "pessoal" as const },
      { pattern: "mercado livre", category_id: "b", scope: "empresa" as const },
    ];
    expect(suggestRule("Compra MERCADO LIVRE 123", rules)?.category_id).toBe("b");
    expect(suggestRule("Café", rules)).toBeNull();
  });
});
