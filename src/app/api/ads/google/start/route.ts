import type { NextRequest } from "next/server";
import { startOAuth } from "@/lib/ads/oauth";
import { googleAdsAuthUrl, googleAdsConfigured } from "@/lib/ads/google-ads";

export function GET(request: NextRequest) {
  return startOAuth(request, googleAdsConfigured(), googleAdsAuthUrl, "/api/ads/google");
}
