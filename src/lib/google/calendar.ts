import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, encrypt } from "@/lib/crypto";
import { publicEnv } from "@/lib/env";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";
export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.TOKEN_ENCRYPTION_KEY && process.env.SUPABASE_SECRET_KEY);
}

export const redirectUri = () => `${publicEnv.NEXT_PUBLIC_SITE_URL}/api/google/oauth/callback`;

export function authUrl(state: string) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${q.toString()}`;
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; id_token?: string; error?: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...body }),
    cache: "no-store",
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok) throw Object.assign(new Error(json.error ?? "token_error"), { code: json.error });
  return json;
}

export async function exchangeCode(code: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  // E-mail vem do id_token (JWT assinado pelo Google; recebido direto do endpoint de token via TLS).
  const payload = t.id_token ? JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString("utf8")) : {};
  return { ...t, email: (payload.email as string | undefined) ?? "" };
}

type Connection = {
  user_id: string;
  organization_id: string;
  calendar_id: string;
  refresh_token_enc: string;
  access_token_enc: string | null;
  access_expires_at: string | null;
  sync_token: string | null;
};

async function accessToken(conn: Connection): Promise<string> {
  if (conn.access_token_enc && conn.access_expires_at && new Date(conn.access_expires_at).getTime() > Date.now() + 60_000) {
    return decrypt(conn.access_token_enc);
  }
  const admin = createAdminClient();
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(conn.refresh_token_enc) });
    await admin
      .from("google_calendar_connections")
      .update({ access_token_enc: encrypt(t.access_token), access_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(), status: "ativa", last_error: null })
      .eq("user_id", conn.user_id);
    return t.access_token;
  } catch (e) {
    const code = (e as { code?: string }).code;
    await admin
      .from("google_calendar_connections")
      .update({ status: code === "invalid_grant" ? "revogada" : "erro", last_error: code === "invalid_grant" ? "Acesso revogado no Google. Conecte novamente." : "Falha ao renovar o acesso." })
      .eq("user_id", conn.user_id);
    throw e;
  }
}

export async function revoke(refreshEnc: string) {
  try {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(decrypt(refreshEnc))}`, { method: "POST", cache: "no-store" });
  } catch {
    /* revogação é melhor esforço; a conexão é apagada de qualquer forma */
  }
}

type GEvent = {
  id: string;
  status: string;
  etag: string;
  updated: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
};

async function api<T>(token: string, path: string, init?: RequestInit): Promise<{ status: number; data: T }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const data = res.status === 204 ? (null as T) : ((await res.json().catch(() => null)) as T);
  return { status: res.status, data };
}

function toGoogle(e: { id: string; title: string; description: string | null; location: string | null; starts_at: string; ends_at: string; all_day: boolean; meet_url: string | null }) {
  const day = (iso: string, plus = 0) => new Date(new Date(iso).getTime() + plus * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return {
    summary: e.title,
    description: [e.description, e.meet_url].filter(Boolean).join("\n\n") || undefined,
    location: e.location ?? undefined,
    start: e.all_day ? { date: day(e.starts_at) } : { dateTime: e.starts_at, timeZone: "America/Sao_Paulo" },
    end: e.all_day ? { date: day(e.ends_at, 1) } : { dateTime: e.ends_at, timeZone: "America/Sao_Paulo" },
    extendedProperties: { private: { hubsystemId: e.id } },
  };
}

function fromGoogle(g: GEvent) {
  const allDay = Boolean(g.start?.date);
  const starts = allDay ? new Date(`${g.start!.date}T00:00:00-03:00`).toISOString() : g.start?.dateTime;
  // Fim exclusivo no Google para dia inteiro: volta 1 minuto para ficar no último dia.
  const ends = allDay ? new Date(new Date(`${g.end!.date}T00:00:00-03:00`).getTime() - 60_000).toISOString() : g.end?.dateTime;
  return { title: (g.summary || "(sem título)").slice(0, 200), description: g.description?.slice(0, 10000) ?? null, location: g.location?.slice(0, 300) ?? null, meet_url: g.hangoutLink ?? null, starts_at: starts!, ends_at: ends!, all_day: allDay };
}

/** Sincronização bidirecional de um usuário. Retorna contadores. */
export async function syncUser(userId: string) {
  const admin = createAdminClient();
  const { data: conn } = await admin.from("google_calendar_connections").select("*").eq("user_id", userId).maybeSingle();
  if (!conn || conn.status === "revogada") return { pushed: 0, pulled: 0, skipped: true };
  const token = await accessToken(conn as Connection);
  const cal = encodeURIComponent(conn.calendar_id);
  let pushed = 0;
  let pulled = 0;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  // 1) Envia eventos internos novos/alterados.
  const { data: local } = await admin
    .from("calendar_events")
    .select("id, title, description, location, starts_at, ends_at, all_day, meet_url, google_event_id, google_synced_at, updated_at, deleted_at")
    .eq("owner_id", userId)
    .gte("ends_at", since)
    .limit(1000);
  for (const e of local ?? []) {
    const changed = !e.google_synced_at || new Date(e.updated_at).getTime() > new Date(e.google_synced_at).getTime() + 2000;
    if (e.deleted_at) {
      if (e.google_event_id) {
        await api(token, `/calendars/${cal}/events/${encodeURIComponent(e.google_event_id)}`, { method: "DELETE" });
        await admin.from("calendar_events").update({ google_event_id: null, google_synced_at: new Date().toISOString() }).eq("id", e.id);
        pushed++;
      }
      continue;
    }
    if (!changed) continue;
    const body = JSON.stringify(toGoogle(e));
    const res = e.google_event_id
      ? await api<GEvent>(token, `/calendars/${cal}/events/${encodeURIComponent(e.google_event_id)}`, { method: "PATCH", body })
      : await api<GEvent>(token, `/calendars/${cal}/events`, { method: "POST", body });
    if (res.status < 300 && res.data) {
      await admin.from("calendar_events").update({ google_event_id: res.data.id, google_etag: res.data.etag, google_synced_at: new Date(Date.now() + 1000).toISOString() }).eq("id", e.id);
      pushed++;
    }
  }

  // 2) Recebe alterações do Google (incremental por syncToken).
  let pageToken: string | undefined;
  let syncToken: string | undefined = conn.sync_token ?? undefined;
  let nextSync: string | undefined;
  for (let guard = 0; guard < 20; guard++) {
    const q = new URLSearchParams({ singleEvents: "true", showDeleted: "true", maxResults: "250" });
    if (pageToken) q.set("pageToken", pageToken);
    if (syncToken) q.set("syncToken", syncToken);
    else q.set("timeMin", since);
    const res = await api<{ items?: GEvent[]; nextPageToken?: string; nextSyncToken?: string }>(token, `/calendars/${cal}/events?${q.toString()}`);
    if (res.status === 410) {
      // syncToken expirado: recomeça a sincronização completa.
      syncToken = undefined;
      pageToken = undefined;
      continue;
    }
    if (res.status >= 300 || !res.data) throw new Error(`google_list_${res.status}`);
    for (const g of res.data.items ?? []) {
      // Dados externos entram em filtro: só aceita formatos esperados.
      if (!/^[\w-]{1,1024}$/.test(g.id)) continue;
      const rawHub = g.extendedProperties?.private?.hubsystemId;
      const hubId = rawHub && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawHub) ? rawHub : undefined;
      const { data: existing } = await admin
        .from("calendar_events")
        .select("id, google_synced_at, updated_at, deleted_at")
        .eq("owner_id", userId)
        .or(hubId ? `id.eq.${hubId},google_event_id.eq.${g.id}` : `google_event_id.eq.${g.id}`)
        .limit(1)
        .maybeSingle();
      if (g.status === "cancelled") {
        if (existing && !existing.deleted_at) {
          await admin.from("calendar_events").update({ deleted_at: new Date().toISOString(), google_synced_at: new Date(Date.now() + 1000).toISOString() }).eq("id", existing.id);
          pulled++;
        }
        continue;
      }
      if (!g.start || !g.end) continue;
      const fields = fromGoogle(g);
      if (existing) {
        // Conflito: vence a alteração mais recente.
        if (new Date(g.updated).getTime() > new Date(existing.updated_at).getTime()) {
          await admin
            .from("calendar_events")
            .update({ ...fields, google_event_id: g.id, google_etag: g.etag, google_synced_at: new Date(Date.now() + 1000).toISOString(), deleted_at: null })
            .eq("id", existing.id);
          pulled++;
        }
      } else {
        await admin.from("calendar_events").insert({
          ...fields,
          organization_id: conn.organization_id,
          owner_id: userId,
          created_by: userId,
          kind: "compromisso",
          source: "google",
          reminder_minutes: [],
          google_event_id: g.id,
          google_etag: g.etag,
          google_synced_at: new Date(Date.now() + 1000).toISOString(),
        });
        pulled++;
      }
    }
    pageToken = res.data.nextPageToken;
    nextSync = res.data.nextSyncToken ?? nextSync;
    if (!pageToken) break;
  }

  await admin
    .from("google_calendar_connections")
    .update({ sync_token: nextSync ?? conn.sync_token, last_synced_at: new Date().toISOString(), status: "ativa", last_error: null, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  return { pushed, pulled, skipped: false };
}
