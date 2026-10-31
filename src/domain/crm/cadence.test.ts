import { describe, expect, it } from "vitest";
import { inSendWindow } from "./cadence";

const w = { start: "08:00", end: "20:00", days: [1, 2, 3, 4, 5] };

describe("janela de envio das cadências", () => {
  it("respeita horário e dias no fuso de São Paulo", () => {
    // Terça, 03/11/2026: 11:00 UTC = 08:00 em São Paulo
    expect(inSendWindow(w, new Date("2026-11-03T11:00:00Z"))).toBe(true);
    expect(inSendWindow(w, new Date("2026-11-03T10:59:00Z"))).toBe(false);
    // 22:59 UTC = 19:59; 23:00 UTC = 20:00 (fim exclusivo)
    expect(inSendWindow(w, new Date("2026-11-03T22:59:00Z"))).toBe(true);
    expect(inSendWindow(w, new Date("2026-11-03T23:00:00Z"))).toBe(false);
  });
  it("não envia em dias fora da janela", () => {
    // Domingo, 01/11/2026, 12:00 em São Paulo
    expect(inSendWindow(w, new Date("2026-11-01T15:00:00Z"))).toBe(false);
  });
});
