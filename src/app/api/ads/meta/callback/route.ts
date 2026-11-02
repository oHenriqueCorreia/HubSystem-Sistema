import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { checkCallback } from "@/lib/ads/oauth";
import { META_SCOPES, metaExchangeCode } from "@/lib/ads/meta";
import { syncAds } from "@/lib/ads/sync";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const checked = await checkCallback(request, "/api/ads/meta");
  if ("error" in checked) return checked.error;
  const { user, code, back } = checked;
  try {
    const t = await metaExchangeCode(code);
    const { error } = await createAdminClient()
      .from("integration_connections")
      .upsert(
        {
          organization_id: user.organizationId,
          provider: "meta_ads",
          connected_by: user.id,
          external_user: t.user,
          scopes: META_SCOPES,
          token_enc: encrypt(t.token),
          refresh_token_enc: null,
          expires_at: t.expiresAt,
          status: "ativa",
          last_error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,provider" },
      );
    if (error) throw error;
    await syncAds(user.organizationId, "meta_ads").catch(() => null);
    return back("conectado=meta");
  } catch (e) {
    // Código e mensagem da Meta (sem token) para diagnosticar pelo log da Vercel.
    const err = e as { code?: number; subcode?: number; detail?: string; message?: string };
    console.error("[meta-oauth] falha na conexão", { code: err.code, subcode: err.subcode, detail: err.detail ?? err.message });
    return back("erro=falha");
  }
}
