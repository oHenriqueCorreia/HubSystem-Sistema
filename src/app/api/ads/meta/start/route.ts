import type { NextRequest } from "next/server";
import { startOAuth } from "@/lib/ads/oauth";
import { metaAuthUrl, metaConfigured } from "@/lib/ads/meta";

export function GET(request: NextRequest) {
  return startOAuth(request, metaConfigured(), metaAuthUrl, "/api/ads/meta");
}
