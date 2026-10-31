import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { checkCallback } from "@/lib/ads/oauth";
import { GOOGLE_ADS_SCOPE, googleAdsExchangeCode } from "@/lib/ads/google-ads";
import { syncAds } from "@/lib/ads/sync";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const checked = await checkCallback(request, "/api/ads/google");
  if ("error" in checked) return checked.error;
  const { user, code, back } = checked;
  try {
    const t = await googleAdsExchangeCode(code);
    if (!t.refresh_token) return back("erro=sem_refresh");
    const { error } = await createAdminClient()
      .from("integration_connections")
      .upsert(
        {
          organization_id: user.organizationId,
          provider: "google_ads",
          connected_by: user.id,
          external_user: t.email,
          scopes: [GOOGLE_ADS_SCOPE],
          token_enc: encrypt(t.access_token),
          refresh_token_enc: encrypt(t.refresh_token),
          expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
          status: "ativa",
          last_error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,provider" },
      );
    if (error) throw error;
    await syncAds(user.organizationId, "google_ads").catch(() => null);
    return back("conectado=google");
  } catch {
    console.error("[google-ads-oauth] falha na conexão");
    return back("erro=falha");
  }
}
