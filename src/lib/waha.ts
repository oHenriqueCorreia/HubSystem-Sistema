import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { messageIdFromResponse } from "@/domain/whatsapp/waha";
import { brPhoneVariants } from "@/domain/shared/phone";
import { wahaReplyId } from "@/domain/whatsapp/chat";

// WAHA: conexão do WhatsApp por QR Code, num servidor próprio. Não é a API oficial da Meta.
export type WahaConn = { url: string; key: string; session: string };

const EVENTS = ["message.any", "message.ack", "session.status"];

const tunnelHeaders = (url: string): Record<string, string> =>
  new URL(url).hostname.endsWith(".ngrok-free.dev") ? { "ngrok-skip-browser-warning": "1" } : {};

async function call<T>(conn: Pick<WahaConn, "url" | "key">, path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const res = await fetch(`${conn.url}${path}`, {
    ...init,
    headers: { "X-Api-Key": conn.key, "Content-Type": "application/json", Accept: "application/json", ...tunnelHeaders(conn.url), ...(init?.headers ?? {}) },
    cache: "no-store",
    redirect: "error", // a chave nunca acompanha um redirecionamento
    signal: AbortSignal.timeout(init?.timeoutMs ?? 20000),
  });
  if (!res.ok) throw Object.assign(new Error("waha_api"), { status: res.status, detail: (await res.text().catch(() => "")).slice(0, 300) });
  return (await res.json().catch(() => ({}))) as T;
}

/** Confere endereço e chave do servidor antes de salvar. */
export async function wahaPing(conn: Pick<WahaConn, "url" | "key">) {
  await call(conn, "/api/sessions", { timeoutMs: 10000 });
}

/** Cria a sessão ou, se já existir, atualiza o webhook e a inicia de novo. */
export async function wahaStartSession(conn: WahaConn, webhookUrl: string, secret: string) {
  const config = {
    ignore: { status: true, groups: true, channels: true, broadcast: true },
    webhooks: [{ url: webhookUrl, events: EVENTS, hmac: { key: secret } }],
  };
  try {
    await call(conn, "/api/sessions", { method: "POST", body: JSON.stringify({ name: conn.session, start: true, config }) });
  } catch (e) {
    if ((e as { status?: number }).status !== 422) throw e;
    await call(conn, `/api/sessions/${conn.session}`, { method: "PUT", body: JSON.stringify({ config }) });
    await call(conn, `/api/sessions/${conn.session}/start`, { method: "POST" });
  }
}

export type WahaSession = { status: string; me: { id?: string; pushName?: string } | null };

export const wahaSession = (conn: WahaConn) => call<WahaSession>(conn, `/api/sessions/${conn.session}`);

/** QR em imagem base64, pronto para mostrar na tela. */
export async function wahaQr(conn: WahaConn) {
  const r = await call<{ mimetype?: string; data?: string }>(conn, `/api/${conn.session}/auth/qr`);
  return r.data ? `data:${r.mimetype ?? "image/png"};base64,${r.data}` : null;
}

export async function wahaRestart(conn: WahaConn) {
  await call(conn, `/api/sessions/${conn.session}/restart`, { method: "POST" });
}

/** Desconecta o aparelho e apaga a sessão no servidor. */
export async function wahaDeleteSession(conn: WahaConn) {
  await call(conn, `/api/sessions/${conn.session}`, { method: "DELETE" }).catch(() => null);
}

/** Endereço de envio do contato: o WhatsApp pode registrar o número com ou sem o 9º dígito. */
export async function wahaChatId(conn: WahaConn, e164: string) {
  let answered = false;
  for (const variant of brPhoneVariants(e164)) {
    const digits = variant.replace(/\D/g, "");
    const r = await call<{ numberExists?: boolean; chatId?: string }>(conn, `/api/contacts/check-exists?phone=${digits}&session=${conn.session}`, { timeoutMs: 5000 }).catch(() => null);
    if (r) answered = true;
    if (r?.numberExists) return r.chatId || `${digits}@c.us`;
  }
  // Sem resposta é o servidor fora do ar, não um número sem WhatsApp.
  throw Object.assign(new Error("waha_numero"), { detail: answered ? "Este número não tem WhatsApp." : "Não foi possível falar com o servidor do WhatsApp. Confira se ele está ligado." });
}

export async function wahaSendText(conn: WahaConn, chatId: string, text: string, replyTo?: { wamid: string; fromMe: boolean } | null) {
  const reply = replyTo ? { reply_to: wahaReplyId(replyTo.fromMe, chatId, replyTo.wamid) } : {};
  const r = await call<unknown>(conn, "/api/sendText", { method: "POST", body: JSON.stringify({ session: conn.session, chatId, text, ...reply }) });
  return messageIdFromResponse(r);
}

export type OutgoingMedia = { url: string; mime: string; name: string; caption?: string | null; kind: "image" | "video" | "audio" | "document" };

export async function wahaSendMedia(conn: WahaConn, chatId: string, media: OutgoingMedia) {
  const file = { url: media.url, mimetype: media.mime, filename: media.name };
  const caption = media.caption ? { caption: media.caption } : {};
  const plan =
    media.kind === "image"
      ? { path: "/api/sendImage", body: { file, ...caption } }
      : media.kind === "video"
        ? { path: "/api/sendVideo", body: { file, convert: true, ...caption } }
        : media.kind === "audio"
          ? { path: "/api/sendVoice", body: { file, convert: true } }
          : { path: "/api/sendFile", body: { file, ...caption } };
  const r = await call<unknown>(conn, plan.path, { method: "POST", body: JSON.stringify({ session: conn.session, chatId, ...plan.body }), timeoutMs: 45000 });
  return messageIdFromResponse(r);
}

export async function wahaSendSeen(conn: WahaConn, chatId: string) {
  await call(conn, "/api/sendSeen", { method: "POST", body: JSON.stringify({ session: conn.session, chatId }) }).catch(() => null);
}

/**
 * Baixa a mídia recebida. O WAHA monta o link com o próprio endereço interno,
 * então só o caminho é aproveitado: a chave da API nunca vai para outro servidor.
 */
export async function wahaDownload(conn: Pick<WahaConn, "url" | "key">, mediaUrl: string, maxBytes = 25 * 1024 * 1024) {
  const path = new URL(mediaUrl, conn.url);
  const res = await fetch(`${conn.url}${path.pathname}${path.search}`, { headers: { "X-Api-Key": conn.key, ...tunnelHeaders(conn.url) }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(40000) });
  if (!res.ok) throw new Error("waha_media");
  const body = await res.arrayBuffer();
  if (body.byteLength > maxBytes) throw new Error("waha_media_grande");
  return body;
}

/** Assinatura do webhook: HMAC-SHA512 do corpo bruto com o segredo da sessão. */
export function validWahaSignature(rawBody: string, header: string | null, secret: string) {
  if (!header || !secret) return false;
  const expected = Buffer.from(createHmac("sha512", secret).update(rawBody, "utf8").digest("hex"));
  const got = Buffer.from(header);
  return expected.length === got.length && timingSafeEqual(expected, got);
}
