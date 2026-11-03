import "server-only";
import { publicEnv } from "@/lib/env";

// Publicação em Páginas do Facebook e contas profissionais do Instagram (Graph API).
export const SOCIAL_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "pages_manage_engagement", "instagram_basic", "instagram_content_publish", "publish_video", "business_management"];

const version = () => process.env.META_GRAPH_VERSION || "v23.0";
const graph = (path: string) => `https://graph.facebook.com/${version()}${path}`;
const env = (name: string) => (process.env[name] ?? "").trim().replace(/^["']|["']$/g, "");

export const socialConfigured = () => Boolean(env("META_APP_ID") && env("META_APP_SECRET") && process.env.TOKEN_ENCRYPTION_KEY && process.env.SUPABASE_SECRET_KEY);

const redirectUri = () => `${publicEnv.NEXT_PUBLIC_SITE_URL}/api/content/meta/callback`;

export function socialAuthUrl(state: string) {
  const q = new URLSearchParams({ client_id: env("META_APP_ID"), redirect_uri: redirectUri(), state, response_type: "code" });
  // Apps do tipo Empresa: permissões vêm da configuração do Login do Facebook para Empresas.
  const configId = env("META_PUBLISH_CONFIG_ID");
  if (configId) q.set("config_id", configId);
  else q.set("scope", SOCIAL_SCOPES.join(","));
  return `https://www.facebook.com/${version()}/dialog/oauth?${q.toString()}`;
}

export type GraphFailure = Error & { code?: number; detail?: string };

async function call<T>(path: string, init?: { method?: "GET" | "POST"; token?: string; body?: Record<string, unknown>; timeoutMs?: number }): Promise<T> {
  const res = await fetch(graph(path), {
    method: init?.method ?? "GET",
    headers: { ...(init?.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(init?.timeoutMs ?? 30_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number; error_user_msg?: string } };
  if (!res.ok || data.error) throw Object.assign(new Error("meta_api"), { code: data.error?.code, detail: (data.error?.error_user_msg ?? data.error?.message ?? String(res.status)).slice(0, 300) }) as GraphFailure;
  return data;
}

export async function socialExchangeCode(code: string) {
  const base = { client_id: env("META_APP_ID"), client_secret: env("META_APP_SECRET") };
  const short = await call<{ access_token: string }>(`/oauth/access_token?${new URLSearchParams({ ...base, redirect_uri: redirectUri(), code })}`);
  const long = await call<{ access_token: string; expires_in?: number }>(`/oauth/access_token?${new URLSearchParams({ ...base, grant_type: "fb_exchange_token", fb_exchange_token: short.access_token })}`);
  const me = await call<{ id: string; name?: string }>("/me?fields=id,name", { token: long.access_token });
  return { token: long.access_token, expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null, user: me.name ?? me.id };
}

export type SocialAccountData = { platform: "facebook" | "instagram"; externalId: string; pageId: string; name: string; username: string | null; pageToken: string; pictureUrl: string | null };

/** Páginas que a pessoa administra e o Instagram profissional ligado a cada uma. */
export async function socialListAccounts(userToken: string): Promise<SocialAccountData[]> {
  const out: SocialAccountData[] = [];
  let next: string | null = "/me/accounts?fields=id,name,access_token,picture.type(large){url},instagram_business_account{id,username,name,profile_picture_url}&limit=100";
  for (let guard = 0; next && guard < 10; guard++) {
    const page: { data: { id: string; name: string; access_token: string; picture?: { data?: { url?: string } }; instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string } }[]; paging?: { cursors?: { after?: string }; next?: string } } = await call(next, { token: userToken });
    for (const p of page.data) {
      out.push({ platform: "facebook", externalId: p.id, pageId: p.id, name: p.name, username: null, pageToken: p.access_token, pictureUrl: p.picture?.data?.url ?? null });
      const ig = p.instagram_business_account;
      if (ig) out.push({ platform: "instagram", externalId: ig.id, pageId: p.id, name: ig.name ?? ig.username ?? p.name, username: ig.username ?? null, pageToken: p.access_token, pictureUrl: ig.profile_picture_url ?? null });
    }
    next = page.paging?.next && page.paging.cursors?.after ? `/me/accounts?fields=id,name,access_token,picture.type(large){url},instagram_business_account{id,username,name,profile_picture_url}&limit=100&after=${encodeURIComponent(page.paging.cursors.after)}` : null;
  }
  return out;
}

export async function socialRevoke(userToken: string) {
  await call("/me/permissions", { method: "POST", token: userToken, body: { method: "delete" } }).catch(() => null);
}

export type MediaPlan = { imageUrls: string[]; videoUrl: string | null; caption: string; format: "post" | "video" | "reels" | "stories" };
export type PublishResult = { done: true; externalId: string; permalink: string | null } | { done: false; containerId: string };

export async function publishFacebook(pageId: string, token: string, m: MediaPlan): Promise<PublishResult> {
  const link = (id: string) => `https://www.facebook.com/${id}`;
  if (m.format === "stories") return publishFacebookStory(pageId, token, m);
  if (m.videoUrl && m.format === "reels") {
    // Reels do Facebook: abre o envio, a Meta baixa o arquivo do link e depois publica.
    const started = await call<{ video_id: string; upload_url?: string }>(`/${pageId}/video_reels`, { method: "POST", token, body: { upload_phase: "start" } });
    const res = await fetch(started.upload_url ?? `https://rupload.facebook.com/video-upload/${version()}/${started.video_id}`, {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, file_url: m.videoUrl },
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw Object.assign(new Error("meta_api"), { detail: `envio do vídeo recusado (${res.status})` }) as GraphFailure;
    await call(`/${pageId}/video_reels`, { method: "POST", token, body: { upload_phase: "finish", video_id: started.video_id, video_state: "PUBLISHED", description: m.caption } });
    return { done: true, externalId: started.video_id, permalink: `https://www.facebook.com/reel/${started.video_id}` };
  }
  if (m.videoUrl) {
    const r = await call<{ id: string }>(`/${pageId}/videos`, { method: "POST", token, body: { file_url: m.videoUrl, description: m.caption }, timeoutMs: 45_000 });
    return { done: true, externalId: r.id, permalink: link(r.id) };
  }
  if (m.imageUrls.length === 1) {
    const r = await call<{ id: string; post_id?: string }>(`/${pageId}/photos`, { method: "POST", token, body: { url: m.imageUrls[0], caption: m.caption } });
    return { done: true, externalId: r.post_id ?? r.id, permalink: link(r.post_id ?? r.id) };
  }
  // Várias fotos: sobem sem publicar e entram juntas no mesmo post.
  const attached: { media_fbid: string }[] = [];
  for (const url of m.imageUrls) {
    const r = await call<{ id: string }>(`/${pageId}/photos`, { method: "POST", token, body: { url, published: false } });
    attached.push({ media_fbid: r.id });
  }
  const r = await call<{ id: string }>(`/${pageId}/feed`, { method: "POST", token, body: { message: m.caption, ...(attached.length ? { attached_media: attached } : {}) } });
  return { done: true, externalId: r.id, permalink: link(r.id) };
}

/** Stories da Página: foto sobe sem publicar e vira story; vídeo sobe em etapas, como o Reels. A Meta não dá link público de story. */
async function publishFacebookStory(pageId: string, token: string, m: MediaPlan): Promise<PublishResult> {
  if (m.videoUrl) {
    const started = await call<{ video_id: string; upload_url?: string }>(`/${pageId}/video_stories`, { method: "POST", token, body: { upload_phase: "start" } });
    const res = await fetch(started.upload_url ?? `https://rupload.facebook.com/video-upload/${version()}/${started.video_id}`, {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, file_url: m.videoUrl },
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw Object.assign(new Error("meta_api"), { detail: `envio do vídeo recusado (${res.status})` }) as GraphFailure;
    for (let i = 0; i < 6; i++) {
      const state = await call<{ status?: { video_status?: string; processing_phase?: { status?: string } } }>(`/${started.video_id}?fields=status`, { token }).catch(() => null);
      const video = state?.status?.video_status;
      if (video === "error") throw Object.assign(new Error("meta_api"), { detail: "o Facebook não conseguiu processar o vídeo" }) as GraphFailure;
      if (video === "ready") break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    const done = await call<{ post_id?: string }>(`/${pageId}/video_stories`, { method: "POST", token, body: { upload_phase: "finish", video_id: started.video_id } });
    return { done: true, externalId: done.post_id ?? started.video_id, permalink: null };
  }
  const photo = await call<{ id: string }>(`/${pageId}/photos`, { method: "POST", token, body: { url: m.imageUrls[0], published: false } });
  const done = await call<{ post_id?: string }>(`/${pageId}/photo_stories`, { method: "POST", token, body: { photo_id: photo.id } });
  return { done: true, externalId: done.post_id ?? photo.id, permalink: null };
}

/** Cria o contêiner do Instagram. A Meta baixa a mídia dos links, que precisam estar públicos neste momento. */
export async function instagramContainer(igId: string, token: string, m: MediaPlan) {
  // Stories não têm legenda.
  if (m.format === "stories") return (await call<{ id: string }>(`/${igId}/media`, { method: "POST", token, body: { media_type: "STORIES", ...(m.videoUrl ? { video_url: m.videoUrl } : { image_url: m.imageUrls[0] }) } })).id;
  if (m.videoUrl) return (await call<{ id: string }>(`/${igId}/media`, { method: "POST", token, body: { media_type: "REELS", video_url: m.videoUrl, caption: m.caption } })).id;
  if (m.imageUrls.length === 1) return (await call<{ id: string }>(`/${igId}/media`, { method: "POST", token, body: { image_url: m.imageUrls[0], caption: m.caption } })).id;
  const children: string[] = [];
  for (const url of m.imageUrls) children.push((await call<{ id: string }>(`/${igId}/media`, { method: "POST", token, body: { image_url: url, is_carousel_item: true } })).id);
  return (await call<{ id: string }>(`/${igId}/media`, { method: "POST", token, body: { media_type: "CAROUSEL", children: children.join(","), caption: m.caption } })).id;
}

export const instagramContainerStatus = (containerId: string, token: string) => call<{ status_code?: string; status?: string }>(`/${containerId}?fields=status_code,status`, { token });

export async function instagramPublish(igId: string, token: string, containerId: string): Promise<PublishResult> {
  const r = await call<{ id: string }>(`/${igId}/media_publish`, { method: "POST", token, body: { creation_id: containerId } });
  const media = await call<{ permalink?: string }>(`/${r.id}?fields=permalink`, { token }).catch(() => ({ permalink: undefined }));
  return { done: true, externalId: r.id, permalink: media.permalink ?? null };
}

/** true quando a conta ainda pode publicar hoje; desconhecido não bloqueia, a Meta responde na publicação. */
export async function instagramWithinLimit(igId: string, token: string) {
  const r = await call<{ data: { quota_usage?: number; config?: { quota_total?: number } }[] }>(`/${igId}/content_publishing_limit?fields=quota_usage,config`, { token }).catch(() => null);
  const row = r?.data?.[0];
  return !(row?.config?.quota_total && (row.quota_usage ?? 0) >= row.config.quota_total);
}
