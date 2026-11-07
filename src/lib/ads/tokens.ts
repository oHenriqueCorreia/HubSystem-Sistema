import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, encrypt } from "@/lib/crypto";
import { googleAdsRefresh } from "./google-ads";

export type AdProvider = "meta_ads" | "google_ads";

export type Connection = {
  id: string;
  organization_id: string;
  provider: AdProvider;
  status: string;
  token_enc: string;
  refresh_token_enc: string | null;
  expires_at: string | null;
  last_synced_at: string | null;
};

export async function getConnection(organizationId: string, provider: AdProvider) {
  const { data } = await createAdminClient().from("integration_connections").select("*").eq("organization_id", organizationId).eq("provider", provider).maybeSingle();
  return (data as Connection | null) ?? null;
}

/** Google: o token de acesso dura 1 hora; renova pelo refresh token e guarda o novo. */
export async function googleAccessToken(conn: Connection) {
  if (conn.expires_at && new Date(conn.expires_at).getTime() > Date.now() + 60_000) return decrypt(conn.token_enc);
  const t = await googleAdsRefresh(decrypt(conn.refresh_token_enc!));
  await createAdminClient()
    .from("integration_connections")
    .update({ token_enc: encrypt(t.access_token), expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString() })
    .eq("id", conn.id);
  return t.access_token;
}

/** Token pronto para chamar a API; a Meta expira em ~60 dias e não renova sozinha. */
export async function accessToken(conn: Connection) {
  if (conn.provider === "google_ads") return googleAccessToken(conn);
  if (conn.expires_at && new Date(conn.expires_at).getTime() < Date.now()) throw Object.assign(new Error("expired"), { code: 190 });
  return decrypt(conn.token_enc);
}
