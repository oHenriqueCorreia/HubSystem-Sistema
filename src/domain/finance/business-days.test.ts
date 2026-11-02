import { describe, expect, it } from "vitest";
import { easter, isBusinessDay, nthBusinessDay, upcomingDueDates } from "./business-days";

describe("dias úteis", () => {
  it("calcula a Páscoa", () => {
    expect(easter(2026).toISOString().slice(0, 10)).toBe("2026-04-05");
    expect(easter(2027).toISOString().slice(0, 10)).toBe("2027-03-28");
  });

  it("ignora fim de semana e feriados nacionais e móveis", () => {
    expect(isBusinessDay("2026-11-02")).toBe(false); // Finados
    expect(isBusinessDay("2026-11-07")).toBe(false); // sábado
    expect(isBusinessDay("2027-02-08")).toBe(false); // Carnaval
    expect(isBusinessDay("2026-11-03")).toBe(true);
  });

  it("encontra o 5º dia útil (iguais ao banco)", () => {
    expect(nthBusinessDay("2026-11", 5)).toBe("2026-11-09");
    expect(nthBusinessDay("2027-01", 5)).toBe("2027-01-08");
    expect(nthBusinessDay("2027-02", 5)).toBe("2027-02-05");
  });

  it("lista os próximos vencimentos", () => {
    expect(upcomingDueDates({ startMonth: "2026-11", frequency: "mensal", rule: "dia_util", day: 5, count: 3 })).toEqual(["2026-11-09", "2026-12-07", "2027-01-08"]);
    expect(upcomingDueDates({ startMonth: "2027-01", frequency: "mensal", rule: "dia_fixo", day: 31, count: 2 })).toEqual(["2027-01-31", "2027-02-28"]);
  });
});
