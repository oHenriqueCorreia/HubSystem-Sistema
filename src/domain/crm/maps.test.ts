import { describe, expect, it } from "vitest";
import { leadMapsUrl } from "./maps";

const lead = {
  name: "Café Central",
  address: "Rua das Flores, 10",
  neighborhood: "Centro",
  city: "Curitiba",
  state: "PR",
  place_id: "ChIJexample",
  gmb_url: null,
};

describe("leadMapsUrl", () => {
  it("uses the precise Google place when available", () => {
    const url = new URL(leadMapsUrl(lead));
    expect(url.hostname).toBe("www.google.com");
    expect(url.searchParams.get("query_place_id")).toBe("ChIJexample");
    expect(url.searchParams.get("query")).toContain("Rua das Flores, 10");
  });

  it("opens a trusted imported Maps link", () => {
    expect(leadMapsUrl({ ...lead, gmb_url: "https://maps.app.goo.gl/abc123" })).toBe("https://maps.app.goo.gl/abc123");
  });

  it("ignores imported links outside Google Maps", () => {
    const url = new URL(leadMapsUrl({ ...lead, gmb_url: "https://www.google.com.evil.test/maps" }));
    expect(url.hostname).toBe("www.google.com");
    expect(url.searchParams.get("query")).toContain("Curitiba");
  });
});
