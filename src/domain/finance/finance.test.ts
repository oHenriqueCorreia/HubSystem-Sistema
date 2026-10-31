import { describe, expect, it } from "vitest";
import { addMonthsCivil, cashFlow, installmentPlan, isOverdueTxn, type FlowTxn } from "./index";

describe("datas de parcelas", () => {
  it("mantém o dia e ajusta fim de mês", () => {
    expect(addMonthsCivil("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsCivil("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsCivil("2026-11-15", 2)).toBe("2027-01-15");
  });
  it("gera plano de parcelas que soma o total", () => {
    const p = installmentPlan(100000, 3, "2026-11-10");
    expect(p.map((x) => x.dueDate)).toEqual(["2026-11-10", "2026-12-10", "2027-01-10"]);
    expect(p.reduce((s, x) => s + x.amount, 0)).toBe(100000);
    expect(p[0]).toMatchObject({ number: 1, total: 3, amount: 33334 });
  });
});

describe("fluxo de caixa", () => {
  const t = (p: Partial<FlowTxn>): FlowTxn => ({ kind: "receita", status: "pago", amount_cents: 1000, paid_amount_cents: 1000, due_date: "2026-11-01", paid_at: "2026-11-01", ...p });
  it("separa realizado e previsto e acumula o saldo", () => {
    const rows = cashFlow(
      [
        t({ amount_cents: 5000, paid_amount_cents: 5000 }),
        t({ kind: "despesa", amount_cents: 2000, paid_amount_cents: 2000, paid_at: "2026-11-03" }),
        t({ status: "previsto", paid_at: null, paid_amount_cents: null, amount_cents: 3000, due_date: "2026-12-05" }),
        t({ kind: "transferencia", amount_cents: 9999 }),
        t({ status: "cancelado", amount_cents: 7777 }),
      ],
      "mes",
      10000,
    );
    expect(rows).toEqual([
      { period: "2026-11", income: 5000, expense: 2000, incomeForecast: 0, expenseForecast: 0, net: 3000, balance: 13000 },
      { period: "2026-12", income: 0, expense: 0, incomeForecast: 3000, expenseForecast: 0, net: 3000, balance: 16000 },
    ]);
  });
  it("usa a data do pagamento para o realizado", () => {
    const rows = cashFlow([t({ due_date: "2026-10-30", paid_at: "2026-11-02" })], "dia");
    expect(rows[0].period).toBe("2026-11-02");
  });
});

describe("vencidos", () => {
  it("só lançamentos previstos com vencimento passado", () => {
    expect(isOverdueTxn({ status: "previsto", due_date: "2026-10-01" }, "2026-10-30")).toBe(true);
    expect(isOverdueTxn({ status: "pago", due_date: "2026-10-01" }, "2026-10-30")).toBe(false);
    expect(isOverdueTxn({ status: "previsto", due_date: "2026-10-30" }, "2026-10-30")).toBe(false);
  });
});
