import { describe, expect, it } from "vitest";
import { bulkTransferBlock, canRepeatMonthly } from "./bulk";

const row = (over = {}) => ({ kind: "receita", status: "previsto", contract_id: null, recurrence_id: null, installment_group_id: null, ...over });

describe("mover lançamentos em lote", () => {
  it("receita e despesa avulsas podem mudar de área", () => {
    expect(bulkTransferBlock(row())).toBeNull();
    expect(bulkTransferBlock(row({ kind: "despesa" }))).toBeNull();
  });

  it("explica por que os demais ficam de fora", () => {
    expect(bulkTransferBlock(row({ kind: "transferencia" }))).toMatch(/transferência/);
    expect(bulkTransferBlock(row({ contract_id: "c" }))).toMatch(/contrato/);
    expect(bulkTransferBlock(row({ recurrence_id: "r" }))).toMatch(/recorrência/);
  });

  it("só receita avulsa e ativa vira recorrente", () => {
    expect(canRepeatMonthly(row())).toBe(true);
    expect(canRepeatMonthly(row({ status: "pago" }))).toBe(true);
    expect(canRepeatMonthly(row({ kind: "despesa" }))).toBe(false);
    expect(canRepeatMonthly(row({ status: "cancelado" }))).toBe(false);
    expect(canRepeatMonthly(row({ installment_group_id: "g" }))).toBe(false);
    expect(canRepeatMonthly(row({ recurrence_id: "r" }))).toBe(false);
  });
});
