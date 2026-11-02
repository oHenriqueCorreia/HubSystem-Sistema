export type UtmParams = { source: string; medium: string; campaign: string; content?: string; term?: string };

// Mantém as chaves dos parâmetros dinâmicos ({{campaign.name}} na Meta, {campaignid} no Google)
// sem codificar, para a plataforma substituir pelo valor real no clique.
const encode = (v: string) => encodeURIComponent(v.trim()).replace(/%7B/gi, "{").replace(/%7D/gi, "}");

/** Só os parâmetros: o que vai em "Parâmetros de URL" (Meta) ou "Sufixo do URL final" (Google). */
export function utmQuery(p: UtmParams) {
  const pairs: [string, string | undefined][] = [
    ["utm_source", p.source],
    ["utm_medium", p.medium],
    ["utm_campaign", p.campaign],
    ["utm_content", p.content],
    ["utm_term", p.term],
  ];
  return pairs
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `${k}=${encode(v!)}`)
    .join("&");
}

/** URL de destino com as UTMs. Substitui UTMs que já existiam e preserva os outros parâmetros e a âncora (#). */
export function buildUtmUrl(baseUrl: string, p: UtmParams) {
  const [beforeHash, ...hashParts] = baseUrl.trim().split("#");
  const hash = hashParts.length ? `#${hashParts.join("#")}` : "";
  const [path, ...queryParts] = beforeHash.split("?");
  const kept = queryParts
    .join("?")
    .split("&")
    .filter((kv) => kv && !/^utm_/i.test(kv));
  const query = [...kept, utmQuery(p)].filter(Boolean).join("&");
  return `${path}${query ? `?${query}` : ""}${hash}`;
}

/** Nome de campanha em formato de UTM: minúsculas, sem acentos, espaços viram "_". */
export function utmSlug(v: string) {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9{}.]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export type UtmPreset = { id: string; label: string; description: string; params: UtmParams };

export const UTM_PRESETS: UtmPreset[] = [
  {
    id: "meta",
    label: "Meta Ads (preenchimento automático)",
    description: "A Meta troca cada {{…}} pelo nome real da campanha, do conjunto e do anúncio no momento do clique.",
    params: { source: "{{site_source_name}}", medium: "paid_social", campaign: "{{campaign.name}}", content: "{{ad.name}}", term: "{{adset.name}}" },
  },
  {
    id: "google",
    label: "Google Ads (preenchimento automático)",
    description: "O Google troca cada {…} pelo ID da campanha, do anúncio e pela palavra-chave no momento do clique.",
    params: { source: "google", medium: "cpc", campaign: "{campaignid}", content: "{creative}", term: "{keyword}" },
  },
  {
    id: "manual",
    label: "Manual",
    description: "Você escreve cada valor. Use para links em bio, e-mail, WhatsApp ou QR Code.",
    params: { source: "", medium: "", campaign: "", content: "", term: "" },
  },
];
