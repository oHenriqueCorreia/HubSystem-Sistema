import { describe, expect, it } from "vitest";
import { dailyIndex, dayPeriod, greetingFor, hourInSaoPaulo, weatherLabel } from "./index";

describe("tela inicial", () => {
  it("usa o horário de São Paulo para a saudação", () => {
    // 10:30 UTC = 07:30 em São Paulo
    expect(hourInSaoPaulo(new Date("2026-11-03T10:30:00Z"))).toBe(7);
    expect(greetingFor(7)).toBe("Bom dia");
    expect(greetingFor(13)).toBe("Boa tarde");
    expect(greetingFor(19)).toBe("Boa noite");
    expect(dayPeriod(3)).toBe("madrugada");
  });

  it("escolhe o mesmo item o dia todo e não repete até percorrer a lista", () => {
    expect(dailyIndex("2026-11-03", 40)).toBe(dailyIndex("2026-11-03", 40));
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const d = new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10);
      seen.add(dailyIndex(d, 40));
    }
    expect(seen.size).toBe(40);
  });

  it("traduz os códigos de clima", () => {
    expect(weatherLabel(0).label).toBe("Céu limpo");
    expect(weatherLabel(63).icon).toBe("chuva");
    expect(weatherLabel(999).label).toBe("Condição indisponível");
  });
});
