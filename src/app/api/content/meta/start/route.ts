import type { NextRequest } from "next/server";
import { startOAuth } from "@/lib/ads/oauth";
import { socialAuthUrl, socialConfigured } from "@/lib/meta-social";

export function GET(request: NextRequest) {
  return startOAuth(request, socialConfigured(), socialAuthUrl, "/api/content/meta", { permission: "content.publish", backTo: "/conteudo?aba=contas" });
}
