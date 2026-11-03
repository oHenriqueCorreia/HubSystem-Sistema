import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto";
import { wahaChatId, wahaDownload, wahaSendMedia, wahaSendSeen, wahaSendText, type OutgoingMedia, type WahaConn } from "@/lib/waha";
export { isOptOut } from "@/domain/crm/opt-out";

// WhatsApp Business Platform · Cloud API (oficial da Meta).
const version = () => process.env.META_GRAPH_VERSION || "v23.0";
const graph = (path: string) => `https://graph.facebook.com/${version()}${path}`;

export const whatsappConfigured = () => Boolean(process.env.META_APP_SECRET && process.env.WHATSAPP_VERIFY_TOKEN && process.env.TOKEN_ENCRYPTION_KEY && process.env.SUPABASE_SECRET_KEY);

/** Valida X-Hub-Signature-256 (HMAC-SHA256 do corpo bruto com o App Secret). */
export function validSignature(rawBody: string, header: string | null) {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"));
  const got = Buffer.from(header.slice(7));
  return expected.length === got.length && timingSafeEqual(expected, got);
}

type WaError = { error?: { message: string; code: number; error_data?: { details?: string } } };

async function request<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(graph(path), {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json().catch(() => ({}))) as T & WaError;
    // 130429 = limite de taxa; 131056 = limite por par remetente/destinatário.
    if (data.error && [4, 80007, 130429].includes(data.error.code) && attempt < 1) {
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      continue;
    }
    if (!res.ok || data.error) throw Object.assign(new Error("whatsapp_api"), { code: data.error?.code, detail: data.error?.error_data?.details ?? data.error?.message });
    return data;
  }
}

export async function numberInfo(phoneNumberId: string, token: string) {
  return request<{ display_phone_number: string; verified_name: string; quality_rating?: string }>(token, `/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`);
}

async function numberToken(numberId: string) {
  const { data } = await createAdminClient().from("whatsapp_numbers").select("provider, phone_number_id, waba_id, token_enc, waha_url, waha_session").eq("id", numberId).single();
  if (!data) throw new Error("numero");
  const token = decrypt(data.token_enc);
  // Número por QR Code: o envio vai pelo servidor WAHA em vez da API da Meta.
  const waha: WahaConn | null = data.provider === "waha" ? { url: data.waha_url as string, key: token, session: data.waha_session as string } : null;
  return { phoneNumberId: data.phone_number_id as string, wabaId: data.waba_id as string, token, waha };
}

/** Canal de um número: "waha" não tem janela de 24 horas nem modelos da Meta. */
export async function numberProvider(numberId: string) {
  const { data } = await createAdminClient().from("whatsapp_numbers").select("provider, status").eq("id", numberId).single();
  return { provider: (data?.provider ?? "cloud") as "cloud" | "waha", status: (data?.status ?? "desconectado") as string };
}

const to = (e164: string) => e164.replace(/\D/g, "");

export async function sendText(numberId: string, toE164: string, body: string, replyTo?: { wamid: string; fromMe: boolean; participant?: string | null } | null) {
  const n = await numberToken(numberId);
  if (n.waha) return wahaSendText(n.waha, await wahaChatId(n.waha, toE164), body, replyTo);
  const r = await request<{ messages: { id: string }[] }>(n.token, `/${n.phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: to(toE164), type: "text", text: { body, preview_url: true }, ...(replyTo ? { context: { message_id: replyTo.wamid } } : {}) }),
  });
  return r.messages[0].id;
}

/** Foto, vídeo, áudio ou documento, a partir de um link temporário do arquivo. */
export async function sendMedia(numberId: string, toE164: string, media: OutgoingMedia) {
  const n = await numberToken(numberId);
  if (n.waha) return wahaSendMedia(n.waha, await wahaChatId(n.waha, toE164), media);
  const content: Record<string, unknown> = { link: media.url };
  if (media.caption && media.kind !== "audio" && media.kind !== "sticker") content.caption = media.caption;
  if (media.kind === "document") content.filename = media.name;
  const r = await request<{ messages: { id: string }[] }>(n.token, `/${n.phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: to(toE164), type: media.kind, [media.kind]: content }),
  });
  return r.messages[0].id;
}

export async function sendTemplate(numberId: string, toE164: string, name: string, language: string, params: string[]) {
  const n = await numberToken(numberId);
  const components = params.length ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] : [];
  const r = await request<{ messages: { id: string }[] }>(n.token, `/${n.phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", to: to(toE164), type: "template", template: { name, language: { code: language }, components } }),
  });
  return r.messages[0].id;
}

/** Marca como lida no WhatsApp do cliente (os dois tiques azuis). */
export async function markRead(numberId: string, wamid: string, toE164?: string) {
  const n = await numberToken(numberId);
  if (n.waha) {
    // Confirmação de leitura é cortesia: se falhar, a conversa segue normal.
    if (toE164) await wahaChatId(n.waha, toE164).then((chatId) => wahaSendSeen(n.waha!, chatId)).catch(() => null);
    return;
  }
  await request(n.token, `/${n.phoneNumberId}/messages`, { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: wamid }) }).catch(() => null);
}

export async function fetchTemplates(numberId: string) {
  const n = await numberToken(numberId);
  const out: { name: string; language: string; category: string; status: string; components: unknown[] }[] = [];
  let path: string | null = `/${n.wabaId}/message_templates?fields=name,language,category,status,components&limit=100`;
  for (let guard = 0; path && guard < 20; guard++) {
    const page: { data: typeof out; paging?: { next?: string } } = await request(n.token, path);
    out.push(...page.data);
    path = page.paging?.next ? page.paging.next.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+/, "") : null;
  }
  return { wabaId: n.wabaId, templates: out };
}

/** Baixa uma mídia recebida (a URL da Meta expira em minutos e exige o token). */
export async function downloadMedia(numberId: string, mediaId: string) {
  const n = await numberToken(numberId);
  if (n.waha) return { body: await wahaDownload(n.waha, mediaId), mime: "application/octet-stream" };
  const meta = await request<{ url: string; mime_type: string; file_size?: number }>(n.token, `/${mediaId}`);
  if ((meta.file_size ?? 0) > 16 * 1024 * 1024) throw new Error("grande");
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${n.token}` }, cache: "no-store", signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error("media");
  return { body: await res.arrayBuffer(), mime: meta.mime_type };
}

