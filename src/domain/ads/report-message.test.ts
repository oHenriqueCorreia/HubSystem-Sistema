import { describe, expect, it } from "vitest";
import { balanceAlert, clientReport, idleAlert, parseFundingBalance, render, reportVariables, unknownVariables, type ClientPeriod } from "./report-message";

const nb = (s: string) => s.replace(/ /g, " ");
const client = (over: Partial<ClientPeriod> = {}): ClientPeriod => ({
  client: "RC Advocacia",
  platforms: ["meta_ads"],
  spendCents: 95866,
  impressions: 2353,
  reach: 1800,
  clicks: 163,
  conversions: 82,
  ...over,
});

describe("render", () => {
  it("troca as variáveis e mantém as desconhecidas visíveis", () => {
    expect(render("Oi {cliente}, {x}", { cliente: "Loja" })).toBe("Oi Loja, {x}");
  });
  it("aponta variáveis que não existem no tipo de mensagem", () => {
    expect(unknownVariables("alerta_saldo", "{saldo} {investimento}")).toEqual(["investimento"]);
  });
});

describe("relatórios", () => {
  it("monta o mensal no modelo do cliente", () => {
    const r = clientReport("mensal", client(), "2026-09-29", "2026-10-28");
    const t = nb(r.text);
    expect(r.title).toBe("Relatório mensal · RC Advocacia");
    expect(t).toContain("📊 RELATÓRIO Mensal - RC Advocacia");
    expect(t).toContain("📅 Período: 29/09/2026 - 28/10/2026");
    expect(t).toContain("* Investimento: R$ 958,66");
    expect(t).toContain("* Conversões: 82");
    expect(t).toContain("* Custo / Conv. (CPA): R$ 11,69");
    expect(t).toContain("* CPC Médio: R$ 5,88");
    expect(t).toContain("* Impressões: 2.353");
    expect(t).toContain("* CTR: 6,927%");
  });

  it("monta o semanal com a plataforma", () => {
    const t = nb(clientReport("semanal", client({ client: "Loja Ambiente", spendCents: 20598, impressions: 12408, clicks: 265, conversions: 25 }), "2026-10-30", "2026-11-05").text);
    expect(t).toContain("🔷 Meta Ads");
    expect(t).toContain("💵 Custo por Resultado: R$ 8,24");
  });

  it("usa o modelo editado", () => {
    expect(clientReport("semanal", client(), "2026-10-30", "2026-11-05", { semanal: "{cliente}: {investimento}" }).text.replace(/ /g, " ")).toBe("RC Advocacia: R$ 958,66");
  });

  it("não divide por zero", () => {
    const v = reportVariables(client({ spendCents: 0, clicks: 0, impressions: 0, conversions: 0 }), "2026-01-01", "2026-01-07");
    expect([v.custo_por_resultado, v.cpc, v.ctr]).toEqual(["—", "—", "—"]);
  });

  it("lista as duas plataformas", () => {
    expect(reportVariables(client({ platforms: ["meta_ads", "google_ads"] }), "2026-01-01", "2026-01-07").plataformas).toBe("Meta Ads e Google Ads");
  });
});

describe("alertas", () => {
  it("monta o alerta de saldo no modelo do cliente", () => {
    const a = balanceAlert({ name: "Cooperja (Caçarola)", client: null, provider: "meta_ads", status: "Ativa", isPrepay: true }, 1975, 15000);
    const t = nb(a.text);
    expect(t).toContain("📊 Conta Meta Ads: Cooperja (Caçarola)");
    expect(t).toContain("📌 Status: Ativa | Pré-paga");
    expect(t).toContain("💰 Saldo disponível: R$ 19,75");
    expect(t).toContain("está abaixo de R$ 150,00");
  });
  it("informa o dia sem gasto", () => {
    expect(idleAlert({ name: "Loja", client: null, provider: "google_ads", status: null, isPrepay: null }, "2026-11-06").text).toContain("Sem nenhum gasto em 06/11/2026");
  });
});

describe("parseFundingBalance", () => {
  it("lê o saldo das contas pré-pagas da Meta", () => {
    expect(parseFundingBalance("Saldo disponível (R$2,65 BRL)")).toBe(265);
    expect(parseFundingBalance("Saldo disponível (R$1.234,50 BRL)")).toBe(123450);
    expect(parseFundingBalance("Available balance ($1,234.56 USD)")).toBe(123456);
    expect(parseFundingBalance("Saldo disponível (R$150 BRL)")).toBe(15000);
    expect(parseFundingBalance("Mastercard *0798")).toBeNull();
  });
});
