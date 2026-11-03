import { waIdToE164 } from "@/domain/shared/phone";

export type WahaReferral = { source_type: string; source_id: string | null; source_url: string | null; headline: string | null; body: string | null; ctwa_clid: string | null };

export type WahaMedia = { url: string; mime: string; name: string | null };

export type WahaEvent =
  | { kind: "message"; wamid: string; fromMe: boolean; phone: string; name: string; type: string; body: string | null; media: WahaMedia | null; at: string; referral: WahaReferral | null }
  | { kind: "ack"; wamid: string; status: "enviada" | "entregue" | "lida" | "erro" }
  | { kind: "session"; status: string; meId: string | null; meName: string | null }
  | { kind: "ignored" };

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * O envio devolve o id cru (3EB0…) e o webhook, o composto (true_5548…@c.us_3EB0…).
 * Os dois viram a cauda, para o eco e as confirmações acharem a mesma mensagem.
 */
export function bareMessageId(id: string) {
  const cut = id.lastIndexOf("_");
  return cut === -1 ? id : id.slice(cut + 1);
}

/** Id de mensagem na resposta de envio (o formato varia por motor e versão). */
export function messageIdFromResponse(raw: unknown): string | null {
  const r = obj(raw);
  if (!r) return null;
  const id = r.id;
  const inner = obj(id);
  const found = str(id) ?? str(inner?._serialized) ?? str(inner?.id) ?? str(obj(r.key)?.id);
  return found ? bareMessageId(found) : null;
}

/** Só conversas individuais: grupos, estados, listas e canais ficam de fora. */
function phoneOfChat(chat: string | null, alt: string | null) {
  if (!chat) return null;
  if (chat.endsWith("@g.us") || chat.endsWith("@broadcast") || chat.endsWith("@newsletter")) return null;
  // Contato com id oculto (@lid): o telefone real vem na chave alternativa da mensagem.
  const address = chat.endsWith("@lid") ? alt : chat;
  if (!address || address.endsWith("@lid")) return null;
  return waIdToE164(address.split("@")[0].split(":")[0]);
}

function messageType(mime: string | null, rawType: string | null) {
  if (mime?.startsWith("image/")) return rawType === "sticker" ? "sticker" : "image";
  if (mime?.startsWith("audio/")) return "audio";
  if (mime?.startsWith("video/")) return "video";
  if (mime) return "document";
  return "text";
}

/** Anúncio "Clique para WhatsApp": vem no contextInfo da própria mensagem. */
export function referralFromRaw(raw: unknown): WahaReferral | null {
  const m = obj(raw);
  if (!m) return null;
  const candidates = [obj(m.extendedTextMessage)?.contextInfo, obj(m.imageMessage)?.contextInfo, obj(m.videoMessage)?.contextInfo, m.contextInfo];
  const ad = candidates.map(obj).map((c) => obj(c?.externalAdReply) ?? obj(c?.externalAdReplyInfo)).find(Boolean);
  if (!ad) return null;
  const sourceType = str(ad.sourceType) ?? str(ad.source_type);
  const source_id = str(ad.sourceId) ?? str(ad.source_id);
  const ctwa_clid = str(ad.ctwaClid) ?? str(ad.ctwa_clid);
  if (!source_id && !ctwa_clid) return null;
  return { source_type: sourceType ?? "ad", source_id, source_url: str(ad.sourceUrl), headline: str(ad.title), body: str(ad.body), ctwa_clid };
}

const ACK: Record<string, "enviada" | "entregue" | "lida" | "erro"> = { "-1": "erro", "1": "enviada", "2": "entregue", "3": "lida", "4": "lida" };

/** Traduz um evento do WAHA. Nunca lança: o que não é conhecido vira "ignored". */
export function parseWahaEvent(input: unknown): WahaEvent {
  const event = obj(input);
  const payload = obj(event?.payload);
  const name = str(event?.event);
  if (!name || !payload) return { kind: "ignored" };

  if (name === "session.status") {
    const me = obj(event?.me) ?? obj(payload.me);
    return { kind: "session", status: str(payload.status) ?? "", meId: str(me?.id), meName: str(me?.pushName) };
  }

  if (name === "message.ack") {
    const id = str(payload.id);
    const status = ACK[String(payload.ack)];
    return id && status ? { kind: "ack", wamid: bareMessageId(id), status } : { kind: "ignored" };
  }

  if (name !== "message.any" && name !== "message") return { kind: "ignored" };
  const id = str(payload.id);
  const fromMe = payload.fromMe === true;
  const data = obj(payload._data);
  const key = obj(data?.key);
  const phone = phoneOfChat(str(fromMe ? payload.to : payload.from), str(key?.remoteJidAlt));
  if (!id || !phone) return { kind: "ignored" };

  const rawMedia = obj(payload.media);
  const url = str(rawMedia?.url) ?? str(payload.mediaUrl);
  const mime = str(rawMedia?.mimetype) ?? str(payload.mimetype);
  const media = payload.hasMedia === true && url ? { url, mime: mime ?? "application/octet-stream", name: str(rawMedia?.filename) } : null;
  const seconds = typeof payload.timestamp === "number" ? payload.timestamp : null;
  return {
    kind: "message",
    wamid: bareMessageId(id),
    fromMe,
    phone,
    name: str(data?.pushName) ?? "",
    type: messageType(payload.hasMedia === true ? (mime ?? "application/octet-stream") : null, str(payload.type)),
    body: str(payload.body),
    media,
    at: new Date(seconds ? seconds * 1000 : Date.now()).toISOString(),
    referral: referralFromRaw(data?.message),
  };
}

/** Número do próprio aparelho, a partir do id do WAHA (5548…@c.us). */
export function displayPhoneFromMe(id: string | null) {
  return id ? (waIdToE164(id.split("@")[0].split(":")[0]) ?? "") : "";
}

/** Nome de sessão aceito pelo WAHA e pelo banco. */
export function sessionNameFor(numberId: string) {
  return `hub_${numberId.replace(/-/g, "").slice(0, 24)}`;
}

/** Só servidores públicos: evita que o sistema seja usado para sondar a rede interna. */
export function validWahaUrl(raw: string, allowLocal = false): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const isLocal = host === "localhost" || host === "::1" || host === "[::1]" || host.endsWith(".local") || host.endsWith(".internal");
  const isPrivateIp = /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  if (isLocal || isPrivateIp) return allowLocal && url.protocol.startsWith("http") ? url.origin : null;
  return url.protocol === "https:" ? url.origin : null;
}
