import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { checkCallback } from "@/lib/ads/oauth";
import { SOCIAL_SCOPES, socialExchangeCode, socialListAccounts } from "@/lib/meta-social";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const checked = await checkCallback(request, "/api/content/meta", { permission: "content.publish", backTo: "/conteudo?aba=contas" });
  if ("error" in checked) return checked.error;
  const { user, code, back } = checked;
  try {
    const t = await socialExchangeCode(code);
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const { error } = await admin.from("integration_connections").upsert(
      { organization_id: user.organizationId, provider: "meta_social", connected_by: user.id, external_user: t.user, scopes: SOCIAL_SCOPES, token_enc: encrypt(t.token), refresh_token_enc: null, expires_at: t.expiresAt, status: "ativa", last_error: null, updated_at: now },
      { onConflict: "organization_id,provider" },
    );
    if (error) throw error;
    const accounts = await socialListAccounts(t.token);
    // Reconectar renova os tokens sem perder as contas já escolhidas.
    for (const a of accounts) {
      const { error: accountError } = await admin.from("social_accounts").upsert(
        { organization_id: user.organizationId, platform: a.platform, external_id: a.externalId, page_id: a.pageId, name: a.name, username: a.username, token_enc: encrypt(a.pageToken), picture_url: a.pictureUrl, picture_checked_at: now, status: "ativa", last_error: null, updated_at: now },
        { onConflict: "organization_id,platform,external_id" },
      );
      if (accountError) throw accountError;
    }
    const ids = new Set(accounts.map((a) => `${a.platform}:${a.externalId}`));
    const { data: known } = await admin.from("social_accounts").select("id, platform, external_id").eq("organization_id", user.organizationId);
    const gone = (known ?? []).filter((k) => !ids.has(`${k.platform}:${k.external_id}`)).map((k) => k.id as string);
    if (gone.length) await admin.from("social_accounts").update({ status: "desconectada", last_error: "Esta conta não veio na última conexão.", updated_at: now }).in("id", gone);
    return back(`conectado=meta&contas=${accounts.length}`);
  } catch (e) {
    const err = e as { code?: number; detail?: string; message?: string };
    console.error("[meta-conteudo] falha na conexão", { code: err.code, detail: err.detail ?? err.message });
    return back("erro=falha");
  }
}
