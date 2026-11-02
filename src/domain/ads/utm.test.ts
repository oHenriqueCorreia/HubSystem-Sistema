import { describe, expect, it } from "vitest";
import { buildUtmUrl, utmQuery, utmSlug, UTM_PRESETS } from "./utm";

const meta = UTM_PRESETS.find((p) => p.id === "meta")!.params;

describe("utmQuery", () => {
  it("mantém os parâmetros dinâmicos da Meta sem codificar", () => {
    expect(utmQuery(meta)).toBe("utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}");
  });

  it("codifica espaços e acentos e ignora campos vazios", () => {
    expect(utmQuery({ source: "instagram", medium: "bio", campaign: "Black Friday & Natal", content: " ", term: "" })).toBe("utm_source=instagram&utm_medium=bio&utm_campaign=Black%20Friday%20%26%20Natal");
  });
});

describe("buildUtmUrl", () => {
  it("acrescenta as UTMs à URL", () => {
    expect(buildUtmUrl("https://loja.com.br/oferta", { source: "google", medium: "cpc", campaign: "{campaignid}" })).toBe("https://loja.com.br/oferta?utm_source=google&utm_medium=cpc&utm_campaign={campaignid}");
  });

  it("preserva outros parâmetros e a âncora e troca UTMs antigas", () => {
    expect(buildUtmUrl("https://loja.com.br/p?id=7&utm_source=velho#topo", { source: "facebook", medium: "paid_social", campaign: "promo" })).toBe(
      "https://loja.com.br/p?id=7&utm_source=facebook&utm_medium=paid_social&utm_campaign=promo#topo",
    );
  });
});

describe("utmSlug", () => {
  it("converte nome de campanha para o padrão de UTM", () => {
    expect(utmSlug("Promoção de Pneus — Março 2026")).toBe("promocao_de_pneus_marco_2026");
  });
});
