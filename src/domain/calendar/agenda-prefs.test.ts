import { describe, expect, it } from "vitest";
import { DEFAULT_AGENDA_PREFS, isWeekend, parseAgendaPrefs, priorityColor, showsPriorityTag, SWATCHES, visibleDays } from "./agenda-prefs";

describe("preferências da agenda", () => {
  it("sem nada salvo, usa o padrão", () => {
    expect(parseAgendaPrefs(undefined)).toEqual(DEFAULT_AGENDA_PREFS);
    expect(parseAgendaPrefs("lixo")).toEqual(DEFAULT_AGENDA_PREFS);
  });

  it("guarda o que é válido e descarta o resto", () => {
    const p = parseAgendaPrefs({ colorBy: "prioridade", density: "compacta", weekends: false, defaultTab: "mes", hiddenTypes: ["tarefa", "invasor"], priorityColors: { urgente: "roxo", alta: "url(javascript:1)" } });
    expect(p.colorBy).toBe("prioridade");
    expect(p.density).toBe("compacta");
    expect(p.weekends).toBe(false);
    expect(p.defaultTab).toBe("mes");
    expect(p.hiddenTypes).toEqual(["tarefa"]);
    expect(p.priorityColors.urgente).toBe("roxo");
    expect(p.priorityColors.alta).toBe("laranja");
    expect(p.priorityColors.baixa).toBe("cinza");
  });

  it("a cor da prioridade segue a escolha da pessoa", () => {
    const p = parseAgendaPrefs({ priorityColors: { urgente: "verde" } });
    expect(priorityColor("urgente", p)).toBe(SWATCHES.verde);
    expect(priorityColor(null, p)).toBeNull();
    expect(priorityColor(undefined, p)).toBeNull();
  });

  it("a prioridade nunca depende só da cor: alta e urgente aparecem escritas", () => {
    expect(showsPriorityTag("urgente", DEFAULT_AGENDA_PREFS)).toBe(true);
    expect(showsPriorityTag("media", DEFAULT_AGENDA_PREFS)).toBe(false);
    expect(showsPriorityTag("media", { ...DEFAULT_AGENDA_PREFS, colorBy: "prioridade" })).toBe(true);
    expect(showsPriorityTag(null, { ...DEFAULT_AGENDA_PREFS, colorBy: "prioridade" })).toBe(false);
  });

  it("esconde fim de semana só quando pedido", () => {
    expect(isWeekend("2026-11-07")).toBe(true);
    expect(isWeekend("2026-11-08")).toBe(true);
    expect(isWeekend("2026-11-09")).toBe(false);
    const days = ["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"];
    expect(visibleDays(days, DEFAULT_AGENDA_PREFS)).toEqual(days);
    expect(visibleDays(days, { ...DEFAULT_AGENDA_PREFS, weekends: false })).toEqual(["2026-11-06", "2026-11-09"]);
  });
});
