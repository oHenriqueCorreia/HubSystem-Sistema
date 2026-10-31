import { describe, expect, it } from "vitest";
import { findConflicts, layoutDay, minutesOfDay, shiftDay, viewRange, zonedIso, type CalItem } from "./index";

const item = (id: string, start: string, end: string, ownerId = "u1"): CalItem => ({
  id,
  kind: "evento",
  title: id,
  start: zonedIso("2026-11-02", start),
  end: zonedIso("2026-11-02", end),
  allDay: false,
  ownerId,
});

describe("intervalos da agenda", () => {
  it("semana começa no domingo", () => {
    const r = viewRange("semana", "2026-11-04"); // quarta
    expect(r.days[0]).toBe("2026-11-01");
    expect(r.days).toHaveLength(7);
  });
  it("mês cobre semanas completas", () => {
    const r = viewRange("mes", "2026-11-15");
    expect(r.days[0]).toBe("2026-11-01");
    expect(r.days.length % 7).toBe(0);
    expect(r.days).toContain("2026-11-30");
  });
  it("navega por visão", () => {
    expect(shiftDay("dia", "2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftDay("semana", "2026-11-01", -1)).toBe("2026-10-25");
    expect(shiftDay("mes", "2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("fuso horário", () => {
  it("monta e lê horários em São Paulo", () => {
    const iso = zonedIso("2026-11-02", "09:30");
    expect(iso).toBe("2026-11-02T12:30:00.000Z");
    expect(minutesOfDay(iso)).toBe(9 * 60 + 30);
  });
});

describe("conflitos", () => {
  it("detecta sobreposição do mesmo responsável", () => {
    const c = findConflicts([item("a", "09:00", "10:00"), item("b", "09:30", "10:30"), item("c", "10:30", "11:00")]);
    expect([...c].sort()).toEqual(["a", "b"]);
  });
  it("ignora responsáveis diferentes e encostados", () => {
    expect(findConflicts([item("a", "09:00", "10:00"), item("b", "09:30", "10:00", "u2")]).size).toBe(0);
    expect(findConflicts([item("a", "09:00", "10:00"), item("b", "10:00", "11:00")]).size).toBe(0);
  });
});

describe("colunas de sobreposição", () => {
  it("lado a lado quando sobrepõem; coluna cheia quando não", () => {
    const l = layoutDay([item("a", "09:00", "10:00"), item("b", "09:15", "09:45"), item("c", "11:00", "12:00")]);
    expect(l.get("a")).toEqual({ col: 0, cols: 2 });
    expect(l.get("b")).toEqual({ col: 1, cols: 2 });
    expect(l.get("c")).toEqual({ col: 0, cols: 1 });
  });
});
