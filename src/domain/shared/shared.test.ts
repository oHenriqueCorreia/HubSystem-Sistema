import { describe, expect, it } from "vitest";
import { formatBRL, parseBRL, splitInstallments } from "./money";
import { fillTemplate, normalizePhone, whatsappLink } from "./phone";
import { formatDate, parseBrDate, todayLocal } from "./dates";
import { canOnRecord } from "@/domain/permissions";
import { safeNext } from "@/features/auth/schemas";

describe("dinheiro", () => {
  it("formata centavos em BRL", () => {
    expect(formatBRL(123456)).toBe("R$ 1.234,56");
  });
  it("interpreta valores digitados", () => {
    expect(parseBRL("1.234,56")).toBe(123456);
    expect(parseBRL("R$ 10")).toBe(1000);
    expect(parseBRL("10,5")).toBe(1050);
    expect(parseBRL("99.90")).toBe(9990);
    expect(parseBRL("abc")).toBeNull();
    expect(parseBRL("")).toBeNull();
  });
  it("divide parcelas sem perder centavos", () => {
    const parts = splitInstallments(10000, 3);
    expect(parts).toEqual([3334, 3333, 3333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(() => splitInstallments(100, 0)).toThrow();
  });
});

describe("telefone", () => {
  it("normaliza celular brasileiro para E.164", () => {
    expect(normalizePhone("(11) 99272-2188")).toMatchObject({ e164: "+5511992722188", type: "celular" });
  });
  it("normaliza fixo", () => {
    expect(normalizePhone("(11) 4123-4567")?.e164).toBe("+551141234567");
  });
  it("rejeita número inválido", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
  it("monta link do WhatsApp com mensagem", () => {
    expect(whatsappLink("+5511992722188", "Olá, tudo bem?")).toBe("https://wa.me/5511992722188?text=Ol%C3%A1%2C%20tudo%20bem%3F");
  });
  it("preenche variáveis e preserva as ausentes", () => {
    expect(fillTemplate("Oi {nome}, da {empresa}! {x}", { nome: "Ana", empresa: "Vidros Sol" })).toBe(
      "Oi Ana, da Vidros Sol! {x}",
    );
  });
});

describe("datas", () => {
  it("formata data civil sem deslocar o dia", () => {
    expect(formatDate("2026-01-01")).toBe("01/01/2026");
  });
  it("formata instante no fuso de São Paulo", () => {
    expect(formatDate("2026-01-01T02:00:00Z")).toBe("31/12/2025");
  });
  it("interpreta data brasileira", () => {
    expect(parseBrDate("31/12/2026")).toBe("2026-12-31");
    expect(parseBrDate("31/02/2026")).toBeNull();
  });
  it("calcula hoje em São Paulo", () => {
    expect(todayLocal(new Date("2026-03-01T02:30:00Z"))).toBe("2026-02-28");
  });
});

describe("permissões", () => {
  it("escopo próprio só vale para o dono", () => {
    expect(canOnRecord({ "crm.leads.update": "own" }, "crm.leads.update", "u1", "u1")).toBe(true);
    expect(canOnRecord({ "crm.leads.update": "own" }, "crm.leads.update", "u2", "u1")).toBe(false);
    expect(canOnRecord({ "crm.leads.update": "all" }, "crm.leads.update", "u2", "u1")).toBe(true);
    expect(canOnRecord({}, "crm.leads.update", "u1", "u1")).toBe(false);
  });
  it("bloqueia redirecionamento aberto", () => {
    expect(safeNext("/crm/leads")).toBe("/crm/leads");
    expect(safeNext("//evil.com")).toBe("/inicio");
    expect(safeNext("https://evil.com")).toBe("/inicio");
    expect(safeNext("/\\evil.com")).toBe("/inicio");
  });
});
