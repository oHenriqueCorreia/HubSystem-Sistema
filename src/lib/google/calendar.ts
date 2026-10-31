import "server-only";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, encrypt } from "@/lib/crypto";
import { publicEnv } from "@/lib/env";
import type { Interval } from "@/domain/calendar";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";

// Escopos mínimos: eventos (criar/editar/convidar), disponibilidade (somente
// livre/ocupado, sem detalhes) e lista de agendas (para escolher quais contam).
export const SCOPE_EVENTS = "https://www.googleapis.com/auth/calendar.events";
export const SCOPE_FREEBUSY = "https://www.googleapis.com/auth/calendar.freebusy";
export const SCOPE_CALENDAR_LIST = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
export const GOOGLE_SCOPES = ["openid", "email", SCOPE_EVENTS, SCOPE_FREEBUSY, SCOPE_CALENDAR_LIST];

const TASK_PREFIX = "Tarefa: ";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.TOKEN_ENCRYPTION_KEY && process.env.SUPABASE_SECRET_KEY);
}

export const redirectUri = () => `${publicEnv.NEXT_PUBLIC_SITE_URL}/api/google/oauth/callback`;
const webhookUrl = () => `${publicEnv.NEXT_PUBLIC_SITE_URL}/api/google/webhook`;

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

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; id_token?: string; scope?: string; error?: string };

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
  return { ...t, email: (payload.email as string | undefined) ?? "", scopes: (t.scope ?? "").split(" ").filter(Boolean) };
}

type Connection = {
  user_id: string;
  organization_id: string;
  calendar_id: string;
  refresh_token_enc: string;
  access_token_enc: string | null;
  access_expires_at: string | null;
  sync_token: string | null;
  scopes: string[];
  busy_calendar_ids: string[];
  channel_id: string | null;
  channel_resource_id: string | null;
  channel_expires_at: string | null;
};

async function getConnection(userId: string): Promise<(Connection & { status: string }) | null> {
  const { data } = await createAdminClient().from("google_calendar_connections").select("*").eq("user_id", userId).maybeSingle();
  return (data as (Connection & { status: string }) | null) ?? null;
}

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

type GAttendee = { email?: string; displayName?: string; optional?: boolean; responseStatus?: string; self?: boolean; organizer?: boolean };
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
  attendees?: GAttendee[];
  extendedProperties?: { private?: Record<string, string> };
};

async function api<T>(token: string, path: string, init?: RequestInit): Promise<{ status: number; data: T }> {
  // Respeita limites: em 429/5xx tenta de novo até 2 vezes com espera crescente.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    const data = res.status === 204 ? (null as T) : ((await res.json().catch(() => null)) as T);
    return { status: res.status, data };
  }
}

const day = (iso: string, plus = 0) => new Date(new Date(iso).getTime() + plus * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

type LocalEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  meet_url: string | null;
  send_updates: boolean;
  guests: { email: string; name: string; optional: boolean }[];
};

function toGoogle(e: LocalEvent) {
  return {
    summary: e.title,
    description: [e.description, e.meet_url].filter(Boolean).join("\n\n") || undefined,
    location: e.location ?? undefined,
    start: e.all_day ? { date: day(e.starts_at) } : { dateTime: e.starts_at, timeZone: "America/Sao_Paulo" },
    end: e.all_day ? { date: day(e.ends_at, 1) } : { dateTime: e.ends_at, timeZone: "America/Sao_Paulo" },
    attendees: e.guests.map((g) => ({ email: g.email, displayName: g.name || undefined, optional: g.optional || undefined })),
    extendedProperties: { private: { hubsystemId: e.id } },
  };
}

type LocalTask = { id: string; title: string; description: string | null; due_at: string; has_time: boolean; duration_minutes: number | null; status: string };

function taskToGoogle(t: LocalTask) {
  const end = new Date(new Date(t.due_at).getTime() + (t.duration_minutes ?? 30) * 60_000).toISOString();
  const done = t.status === "concluida" ? " (concluída)" : "";
  return {
    summary: `${TASK_PREFIX}${t.title}${done}`,
    description: [t.description, `Tarefa do Hub System: ${publicEnv.NEXT_PUBLIC_SITE_URL}/tarefas`].filter(Boolean).join("\n\n"),
    start: t.has_time ? { dateTime: t.due_at, timeZone: "America/Sao_Paulo" } : { date: day(t.due_at) },
    end: t.has_time ? { dateTime: end, timeZone: "America/Sao_Paulo" } : { date: day(t.due_at, 1) },
    transparency: "transparent",
    extendedProperties: { private: { hubsystemTaskId: t.id } },
  };
}

function fromGoogle(g: GEvent) {
  const allDay = Boolean(g.start?.date);
  const starts = allDay ? new Date(`${g.start!.date}T00:00:00-03:00`).toISOString() : g.start?.dateTime;
  // Fim exclusivo no Google para dia inteiro: volta 1 minuto para ficar no último dia.
  const ends = allDay ? new Date(new Date(`${g.end!.date}T00:00:00-03:00`).getTime() - 60_000).toISOString() : g.end?.dateTime;
  return { title: (g.summary || "(sem título)").slice(0, 200), description: g.description?.slice(0, 10000) ?? null, location: g.location?.slice(0, 300) ?? null, meet_url: g.hangoutLink ?? null, starts_at: starts!, ends_at: ends!, all_day: allDay };
}

const RESPONSES = new Set(["needsAction", "accepted", "declined", "tentative"]);
const synced = () => new Date(Date.now() + 1000).toISOString();

/** Sincronização bidirecional de um usuário (eventos e tarefas). Retorna contadores. */
export async function syncUser(userId: string) {
  const admin = createAdminClient();
  const conn = await getConnection(userId);
  if (!conn || conn.status === "revogada") return { pushed: 0, pulled: 0, skipped: true };
  const token = await accessToken(conn);
  const cal = encodeURIComponent(conn.calendar_id);
  let pushed = 0;
  let pulled = 0;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  // 1) Envia eventos internos novos/alterados (com convidados).
  const { data: local } = await admin
    .from("calendar_events")
    .select("id, title, description, location, starts_at, ends_at, all_day, meet_url, send_updates, google_event_id, google_synced_at, updated_at, deleted_at, event_guests(email, name, optional)")
    .eq("owner_id", userId)
    .gte("ends_at", since)
    .limit(1000);
  for (const e of local ?? []) {
    const guests = (e.event_guests as LocalEvent["guests"] | null) ?? [];
    const notify = e.send_updates && guests.length ? "all" : "none";
    const changed = !e.google_synced_at || new Date(e.updated_at).getTime() > new Date(e.google_synced_at).getTime() + 2000;
    if (e.deleted_at) {
      if (e.google_event_id) {
        await api(token, `/calendars/${cal}/events/${encodeURIComponent(e.google_event_id)}?sendUpdates=${notify}`, { method: "DELETE" });
        await admin.from("calendar_events").update({ google_event_id: null, google_synced_at: new Date().toISOString() }).eq("id", e.id);
        pushed++;
      }
      continue;
    }
    if (!changed) continue;
    const body = JSON.stringify(toGoogle({ ...(e as unknown as LocalEvent), guests }));
    const res = e.google_event_id
      ? await api<GEvent>(token, `/calendars/${cal}/events/${encodeURIComponent(e.google_event_id)}?sendUpdates=${notify}`, { method: "PATCH", body })
      : await api<GEvent>(token, `/calendars/${cal}/events?sendUpdates=${notify}`, { method: "POST", body });
    if (res.status < 300 && res.data) {
      await admin.from("calendar_events").update({ google_event_id: res.data.id, google_etag: res.data.etag, google_synced_at: synced() }).eq("id", e.id);
      pushed++;
    }
  }

  // 2) Envia tarefas com prazo (aparecem como "livre" para não bloquear a agenda).
  const { data: tasks } = await admin
    .from("tasks")
    .select("id, title, description, due_at, has_time, duration_minutes, status, google_event_id, google_synced_at, updated_at, deleted_at")
    .eq("owner_id", userId)
    .not("due_at", "is", null)
    .gte("due_at", since)
    .limit(1000);
  for (const t of tasks ?? []) {
    const gone = t.deleted_at || t.status === "cancelada";
    if (gone) {
      if (t.google_event_id) {
        await api(token, `/calendars/${cal}/events/${encodeURIComponent(t.google_event_id)}`, { method: "DELETE" });
        await admin.from("tasks").update({ google_event_id: null, google_synced_at: new Date().toISOString() }).eq("id", t.id);
        pushed++;
      }
      continue;
    }
    const changed = !t.google_synced_at || new Date(t.updated_at).getTime() > new Date(t.google_synced_at).getTime() + 2000;
    if (!changed) continue;
    const body = JSON.stringify(taskToGoogle(t as LocalTask));
    let res = t.google_event_id
      ? await api<GEvent>(token, `/calendars/${cal}/events/${encodeURIComponent(t.google_event_id)}`, { method: "PATCH", body })
      : await api<GEvent>(token, `/calendars/${cal}/events`, { method: "POST", body });
    // Evento apagado no Google: recria em vez de falhar.
    if ((res.status === 404 || res.status === 410) && t.google_event_id) res = await api<GEvent>(token, `/calendars/${cal}/events`, { method: "POST", body });
    if (res.status < 300 && res.data) {
      await admin.from("tasks").update({ google_event_id: res.data.id, google_etag: res.data.etag, google_synced_at: synced() }).eq("id", t.id);
      pushed++;
    }
  }

  // 3) Recebe alterações do Google (incremental por syncToken).
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

      // Tarefas: só a data/hora volta do Google (o resto é editado no sistema).
      const rawTask = g.extendedProperties?.private?.hubsystemTaskId;
      if (rawTask) {
        if (!UUID_RE.test(rawTask)) continue;
        const { data: task } = await admin.from("tasks").select("id, updated_at, due_at, has_time").eq("id", rawTask).eq("owner_id", userId).maybeSingle();
        if (!task) continue;
        if (g.status === "cancelled") {
          await admin.from("tasks").update({ google_event_id: null, google_synced_at: synced() }).eq("id", task.id);
          continue;
        }
        const due = g.start?.dateTime ?? (g.start?.date ? new Date(`${g.start.date}T23:59:00-03:00`).toISOString() : null);
        if (due && new Date(g.updated).getTime() > new Date(task.updated_at).getTime() && new Date(due).getTime() !== new Date(task.due_at).getTime()) {
          await admin.from("tasks").update({ due_at: due, has_time: Boolean(g.start?.dateTime), google_etag: g.etag, google_synced_at: synced() }).eq("id", task.id);
          pulled++;
        }
        continue;
      }

      const rawHub = g.extendedProperties?.private?.hubsystemId;
      const hubId = rawHub && UUID_RE.test(rawHub) ? rawHub : undefined;
      const { data: existing } = await admin
        .from("calendar_events")
        .select("id, google_synced_at, updated_at, deleted_at")
        .eq("owner_id", userId)
        .or(hubId ? `id.eq.${hubId},google_event_id.eq.${g.id}` : `google_event_id.eq.${g.id}`)
        .limit(1)
        .maybeSingle();
      if (g.status === "cancelled") {
        if (existing && !existing.deleted_at) {
          await admin.from("calendar_events").update({ deleted_at: new Date().toISOString(), google_synced_at: synced() }).eq("id", existing.id);
          pulled++;
        }
        continue;
      }
      if (!g.start || !g.end) continue;
      const fields = fromGoogle(g);
      let eventId = existing?.id as string | undefined;
      if (existing) {
        // Conflito: vence a alteração mais recente.
        if (new Date(g.updated).getTime() > new Date(existing.updated_at).getTime()) {
          await admin.from("calendar_events").update({ ...fields, google_event_id: g.id, google_etag: g.etag, google_synced_at: synced(), deleted_at: null }).eq("id", existing.id);
          pulled++;
        }
      } else {
        const { data: created } = await admin
          .from("calendar_events")
          .insert({
            ...fields,
            organization_id: conn.organization_id,
            owner_id: userId,
            created_by: userId,
            kind: "compromisso",
            source: "google",
            reminder_minutes: [],
            send_updates: false,
            google_event_id: g.id,
            google_etag: g.etag,
            google_synced_at: synced(),
          })
          .select("id")
          .single();
        eventId = created?.id;
        pulled++;
      }
      // Respostas dos convidados (aceitou, recusou, talvez) voltam do Google.
      if (eventId && g.attendees?.length) {
        for (const a of g.attendees) {
          if (!a.email || a.self || !RESPONSES.has(a.responseStatus ?? "")) continue;
          await admin.from("event_guests").update({ response_status: a.responseStatus }).eq("event_id", eventId).eq("email", a.email.toLowerCase());
        }
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

/** Sincroniza sem deixar falhas do Google interromperem a ação do usuário. */
export async function syncUserQuietly(userId: string) {
  if (!googleConfigured()) return;
  try {
    await syncUser(userId);
  } catch {
    console.error("[google-sync] falha ao sincronizar após alteração");
  }
}

// --- Disponibilidade (FreeBusy: só livre/ocupado, nunca detalhes) ------------------

export async function googleBusy(userId: string, timeMin: string, timeMax: string): Promise<Interval[] | null> {
  if (!googleConfigured()) return null;
  const conn = await getConnection(userId);
  if (!conn || conn.status !== "ativa" || !conn.scopes.includes(SCOPE_FREEBUSY)) return null;
  const token = await accessToken(conn);
  const ids = conn.busy_calendar_ids.length ? conn.busy_calendar_ids : ["primary"];
  const res = await api<{ calendars?: Record<string, { busy?: Interval[] }> }>(token, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin, timeMax, timeZone: "America/Sao_Paulo", items: ids.map((id) => ({ id })) }),
  });
  if (res.status >= 300 || !res.data?.calendars) return null;
  return Object.values(res.data.calendars).flatMap((c) => c.busy ?? []);
}

export type GoogleCalendarOption = { id: string; summary: string; primary: boolean };

export async function listGoogleCalendars(userId: string): Promise<GoogleCalendarOption[] | null> {
  if (!googleConfigured()) return null;
  const conn = await getConnection(userId);
  if (!conn || conn.status !== "ativa" || !conn.scopes.includes(SCOPE_CALENDAR_LIST)) return null;
  const token = await accessToken(conn);
  const res = await api<{ items?: { id: string; summary?: string; primary?: boolean }[] }>(token, "/users/me/calendarList?minAccessRole=freeBusyReader&maxResults=100");
  if (res.status >= 300 || !res.data?.items) return null;
  return res.data.items.map((c) => ({ id: c.id, summary: c.summary ?? c.id, primary: Boolean(c.primary) }));
}

// --- Notificações push (webhook) ----------------------------------------------------

/** Abre (ou renova) o canal de notificações; o Google avisa a cada alteração. */
export async function watchCalendar(userId: string) {
  if (!publicEnv.NEXT_PUBLIC_SITE_URL.startsWith("https://")) return false; // exige HTTPS público
  const conn = await getConnection(userId);
  if (!conn || conn.status !== "ativa") return false;
  const token = await accessToken(conn);
  await stopChannel(conn, token);
  const id = randomUUID();
  const channelToken = randomBytes(24).toString("base64url");
  const res = await api<{ id: string; resourceId: string; expiration?: string }>(token, `/calendars/${encodeURIComponent(conn.calendar_id)}/events/watch`, {
    method: "POST",
    body: JSON.stringify({ id, type: "web_hook", address: webhookUrl(), token: channelToken, params: { ttl: "604800" } }),
  });
  if (res.status >= 300 || !res.data) return false;
  await createAdminClient()
    .from("google_calendar_connections")
    .update({
      channel_id: id,
      channel_resource_id: res.data.resourceId,
      channel_token: encrypt(channelToken),
      channel_expires_at: res.data.expiration ? new Date(Number(res.data.expiration)).toISOString() : new Date(Date.now() + 6 * 86_400_000).toISOString(),
    })
    .eq("user_id", userId);
  return true;
}

async function stopChannel(conn: Connection, token: string) {
  if (!conn.channel_id || !conn.channel_resource_id) return;
  await api(token, "/channels/stop", { method: "POST", body: JSON.stringify({ id: conn.channel_id, resourceId: conn.channel_resource_id }) }).catch(() => null);
}

/** Encerra o canal antes de desconectar a conta. */
export async function unwatchCalendar(userId: string) {
  const conn = await getConnection(userId);
  if (!conn) return;
  try {
    await stopChannel(conn, await accessToken(conn));
  } catch {
    /* melhor esforço */
  }
}

/** Valida o aviso do Google e devolve o usuário dono do canal. */
export async function userForChannel(channelId: string, channelToken: string): Promise<string | null> {
  if (!UUID_RE.test(channelId) || !channelToken) return null;
  const { data } = await createAdminClient()
    .from("google_calendar_connections")
    .select("user_id, channel_token, status")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (!data?.channel_token || data.status !== "ativa") return null;
  const expected = Buffer.from(decrypt(data.channel_token));
  const got = Buffer.from(channelToken);
  return expected.length === got.length && timingSafeEqual(expected, got) ? data.user_id : null;
}
