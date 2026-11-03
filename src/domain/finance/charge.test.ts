import { describe, expect, it } from "vitest";
import { buildChargeMessage, categorySlices, monthlyEvolution, type DashboardRow } from "./charge";

const profile = { pix_key: "12.345.678/0001-00", pix_key_type: "cnpj", holder_name: "Empresa X", bank_name: "Banco Y", instructions: null };

describe("mensagem de cobrança", () => {
  it("traz nome, motivo, valor, vencimento e Pix", () => {
    const m = buildChargeMessage({ name: "Ana Souza", description: "Site", reason: "mensalidade", note: "Novembro", amountCents: 150000, dueDate: "2026-11-10", profile });
    expect(m).toContain("Olá Ana!");
    expect(m).toContain("Motivo: Mensalidade: Novembro");
    expect(m).toMatch(/R\$\s*1\.500,00/);
    expect(m).toContain("10/11/2026");
    expect(m).toContain("12.345.678/0001-00");
    expect(m).toContain("Empresa X");
  });

  it("sem dados de Pix, não inventa", () => {
    const m = buildChargeMessage({ name: "", description: "Site", reason: null, note: null, amountCents: 100, dueDate: "2026-11-10", profile: null });
    expect(m).not.toContain("Pix");
    expect(m).toContain("Motivo: Site");
  });
});

const row = (over: Partial<DashboardRow>): DashboardRow => ({ kind: "receita", status: "pago", amount_cents: 1000, paid_amount_cents: null, due_date: "2026-11-01", paid_at: "2026-11-02", category_id: "a", ...over });

describe("gráficos", () => {
  const names = new Map([["a", "Vendas"], ["b", "Serviços"]]);

  it("separa efetivo de pendente e usa o valor realmente pago", () => {
    const rows = [row({ paid_amount_cents: 900 }), row({ status: "previsto", paid_at: null, amount_cents: 500 })];
    expect(categorySlices(rows, "receita", "pago", names)[0]).toMatchObject({ name: "Vendas", value: 900, percent: 100 });
    expect(categorySlices(rows, "receita", "previsto", names)[0].value).toBe(500);
  });

  it("calcula percentual e nomeia o que não tem categoria", () => {
    const slices = categorySlices([row({ amount_cents: 750 }), row({ amount_cents: 250, category_id: null })], "receita", "pago", names);
    expect(slices.map((s) => [s.name, s.percent])).toEqual([["Vendas", 75], ["Sem categoria", 25]]);
  });

  it("agrupa o excedente em Outras", () => {
    const many = Array.from({ length: 10 }, (_, i) => row({ category_id: `c${i}`, amount_cents: 100 - i }));
    const slices = categorySlices(many, "receita", "pago", names);
    expect(slices).toHaveLength(8);
    expect(slices.at(-1)?.name).toBe("Outras");
  });

  it("evolução usa a data do pagamento e ignora transferência e cancelado", () => {
    const out = monthlyEvolution([
      row({ paid_at: "2026-10-30", due_date: "2026-11-01" }),
      row({ kind: "despesa", amount_cents: 300, paid_at: "2026-11-02" }),
      row({ status: "previsto", paid_at: null, due_date: "2026-12-01", amount_cents: 700 }),
      row({ kind: "transferencia" }),
      row({ status: "cancelado", paid_at: null }),
    ]);
    expect(out).toEqual([
      { mes: "2026-10", entradas: 1000, saidas: 0, entradasPendentes: 0, saidasPendentes: 0 },
      { mes: "2026-11", entradas: 0, saidas: 300, entradasPendentes: 0, saidasPendentes: 0 },
      { mes: "2026-12", entradas: 0, saidas: 0, entradasPendentes: 700, saidasPendentes: 0 },
    ]);
  });
});
