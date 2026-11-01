import { describe, expect, it } from "vitest";
import { sumConversionActions } from "./conversions";
import { filtersQuery, parseAdsFilters } from "@/features/ads/filters";
import { formatRoas } from "@/features/ads/format";

describe("sumConversionActions", () => {
  it("não conta a compra do pixel quando a Meta já informa purchase", () => {
    const actions = [
      { action_type: "purchase", value: "3" },
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "3" },
      { action_type: "link_click", value: "40" },
    ];
    expect(sumConversionActions(actions)).toBe(3);
  });

  it("usa o evento do pixel quando ele vem sozinho", () => {
    expect(sumConversionActions([{ action_type: "offsite_conversion.fb_pixel_purchase", value: "2" }])).toBe(2);
  });

  it("soma tipos diferentes de conversão e valores decimais", () => {
    const values = [
      { action_type: "lead", value: "5" },
      { action_type: "onsite_conversion.lead_grouped", value: "5" },
      { action_type: "purchase", value: "120.50" },
    ];
    expect(sumConversionActions(values)).toBeCloseTo(125.5);
  });
});

describe("parseAdsFilters", () => {
  it("lê plataforma, status e agrupamento da URL", () => {
    const f = parseAdsFilters({ periodo: "custom", de: "2026-10-01", ate: "2026-10-31", plataforma: "google", status: "ativas", agrupar: "semana" });
    expect(f).toMatchObject({ from: "2026-10-01", to: "2026-10-31", provider: "google_ads", status: "ativas", group: "semana" });
    expect(f.prevTo).toBe("2026-09-30");
  });

  it("ignora valores desconhecidos", () => {
    const f = parseAdsFilters({ plataforma: "tiktok", status: "x", agrupar: "ano" });
    expect(f.provider).toBeUndefined();
    expect(f.status).toBeUndefined();
    expect(f.group).toBe("dia");
  });

  it("volta para a mesma query string", () => {
    const sp = { periodo: "custom", de: "2026-10-01", ate: "2026-10-31", plataforma: "meta", status: "pausadas", conta: "abc" };
    expect(Object.fromEntries(new URLSearchParams(filtersQuery(parseAdsFilters(sp))))).toEqual(sp);
  });
});

describe("formatRoas", () => {
  it("divide valor das conversões pelo investimento", () => {
    expect(formatRoas(32500, 10000)).toBe("3,25x");
  });
  it("mostra traço sem investimento ou sem valor", () => {
    expect(formatRoas(0, 10000)).toBe("—");
    expect(formatRoas(500, 0)).toBe("—");
  });
});
