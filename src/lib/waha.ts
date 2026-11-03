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

// O histórico só vem com o store ligado antes do QR Code: mudar depois exige ler o código de novo.
const sessionConfig = (webhookUrl: string, secret: string, store = true) => ({
  ignore: { status: true, groups: false, channels: true, broadcast: true },
  noweb: { store: { enabled: store, fullSync: store } },
  webhooks: [{ url: webhookUrl, events: EVENTS, hmac: { key: secret } }],
});

/** Cria a sessão ou, se já existir, atualiza o webhook e a inicia de novo. */
export async function wahaStartSession(conn: WahaConn, webhookUrl: string, secret: string) {
  const config = sessionConfig(webhookUrl, secret);
  try {
    await call(conn, "/api/sessions", { method: "POST", body: JSON.stringify({ name: conn.session, start: true, config }) });
  } catch (e) {
    if ((e as { status?: number }).status !== 422) throw e;
    await call(conn, `/api/sessions/${conn.session}`, { method: "PUT", body: JSON.stringify({ config }) });
    await call(conn, `/api/sessions/${conn.session}/start`, { method: "POST" });
  }
}

export type WahaSession = { status: string; me: { id?: string; pushName?: string } | null; config?: { ignore?: { groups?: boolean }; noweb?: { store?: { enabled?: boolean } } } | null };

export const wahaSession = (conn: WahaConn) => call<WahaSession>(conn, `/api/sessions/${conn.session}`);

/** QR em imagem base64, pronto para mostrar na tela. */
export async function wahaQr(conn: WahaConn) {
  const r = await call<{ mimetype?: string; data?: string }>(conn, `/api/${conn.session}/auth/qr`);
  return r.data ? `data:${r.mimetype ?? "image/png"};base64,${r.data}` : null;
}

export async function wahaRestart(conn: WahaConn) {
  await call(conn, `/api/sessions/${conn.session}/restart`, { method: "POST" });
}

/** Sessão pronta para o histórico e os grupos. Se não estiver, é preciso ler o QR Code de novo. */
export const wahaHistoryReady = (session: WahaSession) => session.config?.noweb?.store?.enabled === true && session.config?.ignore?.groups === false;

/** Sai do aparelho e sobe a sessão com o histórico ligado, pronta para um novo QR Code. */
export async function wahaResetForHistory(conn: WahaConn, webhookUrl: string, secret: string) {
  await call(conn, `/api/sessions/${conn.session}/logout`, { method: "POST" }).catch((e) => {
    if ((e as { status?: number }).status !== 404) throw e;
  });
  await wahaStartSession(conn, webhookUrl, secret);
}

/** Liga os grupos sem sair do aparelho: a sessão reinicia e continua conectada. O histórico continua como estava. */
export async function wahaEnableGroups(conn: WahaConn, webhookUrl: string, secret: string, store: boolean) {
  await call(conn, `/api/sessions/${conn.session}`, { method: "PUT", body: JSON.stringify({ config: sessionConfig(webhookUrl, secret, store) }) });
}

/** Grupos de que o número participa. O WAHA devolve um objeto por id ou uma lista, conforme o motor. */
export async function wahaGroups(conn: WahaConn) {
  const raw = await call<unknown>(conn, `/api/${conn.session}/groups?exclude=participants`, { timeoutMs: 30000 });
  const list = Array.isArray(raw) ? raw : Object.values((raw ?? {}) as Record<string, unknown>);
  return (list as { id?: unknown; subject?: unknown; name?: unknown }[]).flatMap((g) => {
    const id = typeof g.id === "string" ? g.id : (g.id as { _serialized?: string } | undefined)?._serialized;
    return id ? [{ id, name: String(g.subject ?? g.name ?? "") }] : [];
  });
}

/** Código de 8 letras que substitui o QR Code. Só vale com a sessão esperando conexão. */
export async function wahaRequestCode(conn: WahaConn, phone: string) {
  const r = await call<{ code?: string }>(conn, `/api/${conn.session}/auth/request-code`, { method: "POST", body: JSON.stringify({ phoneNumber: phone }), timeoutMs: 15000 });
  return r.code ?? null;
}

export type WahaChat = { id: string; name?: string | null };

/** Conversas do aparelho, das mais recentes para as mais antigas. */
export const wahaChatsOverview = (conn: WahaConn, limit: number, offset: number) => call<WahaChat[]>(conn, `/api/${conn.session}/chats/overview?limit=${limit}&offset=${offset}`, { timeoutMs: 20000 });

/** Mensagens de uma conversa, das mais recentes para as mais antigas, sem baixar mídia. */
export const wahaChatMessages = (conn: WahaConn, chatId: string, limit: number, offset: number) =>
  call<unknown[]>(conn, `/api/${conn.session}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}&offset=${offset}&downloadMedia=false&sortBy=messageTimestamp&sortOrder=desc`, { timeoutMs: 20000 });

export async function wahaGroupName(conn: WahaConn, groupId: string) {
  const r = await call<{ subject?: string; name?: string }>(conn, `/api/${conn.session}/groups/${encodeURIComponent(groupId)}`, { timeoutMs: 8000 });
  return r.subject ?? r.name ?? null;
}

/** Telefone real de quem tem id oculto (@lid), quando o servidor já conhece. */
export async function wahaLidPhone(conn: WahaConn, lid: string) {
  const r = await call<{ pn?: string | null }>(conn, `/api/${conn.session}/lids/${encodeURIComponent(lid)}`, { timeoutMs: 8000 });
  return r.pn ?? null;
}

/** Desconecta o aparelho e apaga a sessão no servidor. */
export async function wahaDeleteSession(conn: WahaConn) {
  await call(conn, `/api/sessions/${conn.session}`, { method: "DELETE" }).catch(() => null);
}

/** Endereço de envio do contato: o WhatsApp pode registrar o número com ou sem o 9º dígito. Grupo já é o endereço. */
export async function wahaChatId(conn: WahaConn, e164: string) {
  if (e164.endsWith("@g.us")) return e164;
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

export async function wahaSendText(conn: WahaConn, chatId: string, text: string, replyTo?: { wamid: string; fromMe: boolean; participant?: string | null } | null) {
  const reply = replyTo ? { reply_to: wahaReplyId(replyTo.fromMe, chatId, replyTo.wamid, replyTo.participant) } : {};
  const r = await call<unknown>(conn, "/api/sendText", { method: "POST", body: JSON.stringify({ session: conn.session, chatId, text, ...reply }) });
  return messageIdFromResponse(r);
}

export type OutgoingMedia = { url: string; mime: string; name: string; caption?: string | null; kind: "image" | "video" | "audio" | "document" | "sticker" };

export async function wahaSendMedia(conn: WahaConn, chatId: string, media: OutgoingMedia) {
  const file = { url: media.url, mimetype: media.mime, filename: media.name };
  const caption = media.caption ? { caption: media.caption } : {};
  const plan =
    media.kind === "image"
      ? { path: "/api/sendImage", body: { file, ...caption } }
      : media.kind === "sticker"
        ? { path: "/api/sendSticker", body: { file } }
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
