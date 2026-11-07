import { describe, expect, it } from "vitest";
import { alertsMessage, dailyReport, variation, weeklyReport, type AccountPeriod } from "./report-message";

const acc = (over: Partial<AccountPeriod>): AccountPeriod => ({ name: "Conta", provider: "meta_ads", client: null, spendCents: 0, impressions: 0, clicks: 0, conversions: 0, ...over });

describe("variation", () => {
  it("compara com o período anterior", () => {
    expect(variation(120, 100)).toBe("+20%");
    expect(variation(80, 100)).toBe("−20%");
    expect(variation(100, 100)).toBe("estável");
    expect(variation(50, 0)).toBe("novo");
    expect(variation(0, 0)).toBe("");
    expect(variation(10, null)).toBe("");
  });
});

describe("dailyReport", () => {
  it("agrupa por cliente, ordena por gasto e soma o total", () => {
    const r = dailyReport("2026-11-06", [
      acc({ name: "Loja B", client: "Cliente Z", spendCents: 5000, clicks: 10, impressions: 1000 }),
      acc({ name: "Avulsa", spendCents: 1000, clicks: 2, impressions: 100 }),
      acc({ name: "Loja A", client: "Cliente A", provider: "google_ads", spendCents: 9000, clicks: 30, impressions: 3000, conversions: 3 }),
    ]);
    expect(r.title).toBe("Relatório de anúncios · 06/11");
    const t = r.text.replace(/ /g, " ");
    expect(t.indexOf("*Cliente A*")).toBeLessThan(t.indexOf("*Cliente Z*"));
    expect(t.indexOf("*Cliente Z*")).toBeLessThan(t.indexOf("*Sem cliente*"));
    expect(t).toContain("• Loja A _(Google)_");
    expect(t).toContain("3 conversões (R$ 30,00 cada)");
    expect(t).toContain("*Total do dia:* R$ 150,00 · 42 cliques · 3 conversões");
  });

  it("junta numa linha as contas que não gastaram", () => {
    const r = dailyReport("2026-11-06", [acc({ name: "Ativa", spendCents: 100, impressions: 10 }), acc({ name: "Parada B" }), acc({ name: "Parada A" })]);
    expect(r.text).toContain("_Sem gasto no período:_ Parada A, Parada B");
    expect(r.text).not.toContain("• Parada");
  });

  it("explica quando não há contas", () => {
    expect(dailyReport("2026-11-06", []).text).toContain("Nenhuma conta ativa nos relatórios.");
  });
});

describe("weeklyReport", () => {
  it("mostra a variação do gasto contra a semana anterior", () => {
    const r = weeklyReport("2026-10-31", "2026-11-06", [
      acc({ name: "Loja", spendCents: 15000, previous: { spendCents: 10000, impressions: 0, clicks: 0, conversions: 0 } }),
    ]);
    expect(r.text).toContain("Gasto vs. semana anterior: +50%");
    expect(r.text).toContain("(+50% vs. semana anterior)");
  });
});

describe("alertsMessage", () => {
  it("usa o título do alerta quando é um só", () => {
    const m = alertsMessage([{ title: "Saldo baixo na conta X", detail: "Saldo: R$ 10,00" }]);
    expect(m.title).toBe("Saldo baixo na conta X");
    expect(m.text).toContain("⚠️ *Alerta de anúncios*");
  });
});
