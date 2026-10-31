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
    background_color: "#f5f6f3",
    theme_color: "#0e5e59",
    categories: ["business", "productivity", "finance"],
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Meu dia", url: "/inicio" },
      { name: "Leads", url: "/crm/leads" },
      { name: "Agenda", url: "/agenda" },
    ],
  };
}
