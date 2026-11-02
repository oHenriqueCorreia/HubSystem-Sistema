import { describe, expect, it } from "vitest";
import { dayPeriod, greetingFor, hourInSaoPaulo, rotationIndex, rotationSlot, weatherLabel } from "./index";

describe("tela inicial", () => {
  it("usa o horário de São Paulo para a saudação", () => {
    // 10:30 UTC = 07:30 em São Paulo
    expect(hourInSaoPaulo(new Date("2026-11-03T10:30:00Z"))).toBe(7);
    expect(greetingFor(7)).toBe("Bom dia");
    expect(greetingFor(13)).toBe("Boa tarde");
    expect(greetingFor(19)).toBe("Boa noite");
    expect(dayPeriod(3)).toBe("madrugada");
  });

  it("troca de janela a cada 2 horas no horário de Brasília", () => {
    // 10:00 UTC = 07:00 em São Paulo; 10:59 UTC = 07:59: mesma janela (06h às 08h).
    const slot = rotationSlot(new Date("2026-11-03T10:00:00Z"));
    expect(rotationSlot(new Date("2026-11-03T09:00:00Z"))).toBe(slot);
    expect(rotationSlot(new Date("2026-11-03T10:59:59Z"))).toBe(slot);
    expect(rotationSlot(new Date("2026-11-03T11:00:00Z"))).toBe(slot + 1);
    expect(rotationSlot(new Date("2026-11-03T08:59:59Z"))).toBe(slot - 1);
    // A virada do dia segue Brasília (03:00 UTC = 00:00) e continua a sequência.
    expect(rotationSlot(new Date("2026-11-04T03:00:00Z"))).toBe(rotationSlot(new Date("2026-11-04T02:59:59Z")) + 1);
  });

  it("não repete o item até percorrer a lista, e vizinhos ficam espalhados", () => {
    const seen = new Set<number>();
    for (let slot = 248_000; slot < 248_040; slot++) seen.add(rotationIndex(slot, 40));
    expect(seen.size).toBe(40);
    expect(rotationIndex(248_001, 40)).not.toBe(rotationIndex(248_000, 40));
    expect(Math.abs(rotationIndex(248_001, 40) - rotationIndex(248_000, 40))).toBeGreaterThan(1);
  });

  it("todas as janelas do dia têm passagem diferente", async () => {
    const { VERSES, MESSAGES } = await import("@/features/home/content");
    expect(VERSES.every((v) => v.ref && v.text.trim().length > 10)).toBe(true);
    expect(new Set(VERSES.map((v) => v.ref)).size).toBe(VERSES.length);
    expect(new Set(MESSAGES).size).toBe(MESSAGES.length);
    const slot = rotationSlot(new Date("2026-11-03T03:00:00Z"));
    const today = Array.from({ length: 12 }, (_, i) => rotationIndex(slot + i, VERSES.length));
    expect(new Set(today).size).toBe(12);
  });

  it("toda passagem aparece completa e nenhuma se repete em duas semanas", async () => {
    const { VERSES } = await import("@/features/home/content");
    for (const { ref, text } of VERSES) {
      expect(text, ref).toMatch(/^[“‘]?\p{Lu}/u);
      expect(text, ref).toMatch(/[.!?][”’]*$/);
      expect(text.split("“").length, ref).toBe(text.split("”").length);
    }
    const slot = rotationSlot(new Date("2026-11-03T03:00:00Z"));
    const fortnight = Array.from({ length: 12 * 14 }, (_, i) => rotationIndex(slot + i, VERSES.length));
    expect(new Set(fortnight).size).toBe(12 * 14);
  });

  it("traduz os códigos de clima", () => {
    expect(weatherLabel(0).label).toBe("Céu limpo");
    expect(weatherLabel(63).icon).toBe("chuva");
    expect(weatherLabel(999).label).toBe("Condição indisponível");
  });
});
