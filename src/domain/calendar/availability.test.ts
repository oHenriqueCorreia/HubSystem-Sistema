import { describe, expect, it } from "vitest";
import { freeSlots, mergeIntervals, overlapsBusy, zonedIso } from "./index";

// 03/11/2026 é uma terça-feira; 01/11/2026, domingo.
const day = "2026-11-03";
const at = (t: string) => zonedIso(day, t);
const work = { start: "08:00", end: "18:00", days: [1, 2, 3, 4, 5] };
const before = new Date("2026-11-01T12:00:00Z");

describe("disponibilidade", () => {
  it("une intervalos sobrepostos e encostados", () => {
    const merged = mergeIntervals([
      { start: at("09:00"), end: at("10:00") },
      { start: at("09:30"), end: at("11:00") },
      { start: at("11:00"), end: at("11:30") },
      { start: at("14:00"), end: at("15:00") },
    ]);
    expect(merged).toEqual([
      { start: at("09:00"), end: at("11:30") },
      { start: at("14:00"), end: at("15:00") },
    ]);
  });

  it("calcula faixas livres dentro do expediente em São Paulo", () => {
    const busy = [
      { start: at("07:00"), end: at("09:00") },
      { start: at("12:00"), end: at("13:00") },
      { start: at("17:45"), end: at("19:00") },
    ];
    expect(freeSlots(day, busy, work, 30, before)).toEqual([
      { start: at("09:00"), end: at("12:00") },
      { start: at("13:00"), end: at("17:45") },
    ]);
  });

  it("ignora faixas menores que a duração mínima", () => {
    const busy = [
      { start: at("08:00"), end: at("10:00") },
      { start: at("10:15"), end: at("18:00") },
    ];
    expect(freeSlots(day, busy, work, 30, before)).toEqual([]);
  });

  it("não oferece dias fora do expediente nem horários que já passaram", () => {
    expect(freeSlots("2026-11-01", [], work, 30, before)).toEqual([]);
    const now = new Date(at("16:50"));
    expect(freeSlots(day, [], work, 30, now)).toEqual([{ start: at("17:00"), end: at("18:00") }]);
  });

  it("detecta conflito com horário ocupado", () => {
    const busy = [{ start: at("10:00"), end: at("11:00") }];
    expect(overlapsBusy({ start: at("10:30"), end: at("11:30") }, busy)).toBe(true);
    expect(overlapsBusy({ start: at("11:00"), end: at("11:30") }, busy)).toBe(false);
  });
});
