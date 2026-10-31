import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HubSystem",
    short_name: "HubSystem",
    description: "Gestão comercial, operacional e financeira.",
    lang: "pt-BR",
    start_url: "/inicio",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f3f6fa",
    theme_color: "#0969da",
    categories: ["business", "productivity", "finance"],
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
    shortcuts: [
      { name: "Meu dia", url: "/inicio" },
      { name: "Leads", url: "/crm/leads" },
      { name: "Agenda", url: "/agenda" },
    ],
  };
}
