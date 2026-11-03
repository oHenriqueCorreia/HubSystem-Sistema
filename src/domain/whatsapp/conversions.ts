import { createHash } from "node:crypto";

export type ConversionInput = {
  id: string;
  eventName: string;
  valueCents: number;
  contactE164: string | null;
  ctwaClid: string | null;
  provider: string | null;
  eventTime: string;
};

/** A Meta recusa eventos com mais de 7 dias. */
const MAX_AGE_MS = 7 * 24 * 3600_000;
export const conversionExpired = (eventTime: string, now = Date.now()) => now - new Date(eventTime).getTime() > MAX_AGE_MS;

/** Telefone em SHA-256, só com dígitos e o código do país, como a Meta pede. */
export const hashPhone = (e164: string) => createHash("sha256").update(e164.replace(/\D/g, "")).digest("hex");

/**
 * Evento para a Conversions API. Com a API oficial, a conta WABA e o clique do anúncio,
 * vai como mensagem comercial e a Meta liga direto ao anúncio. No QR Code não há WABA:
 * vai com o telefone em hash, e a atribuição depende de a Meta reconhecer esse telefone.
 */
export function buildConversionEvent(e: ConversionInput, wabaId: string | null) {
  const direct = e.provider === "cloud" && e.ctwaClid && wabaId;
  if (!direct && !e.contactE164) return null;
  return {
    event_name: e.eventName,
    event_time: Math.floor(new Date(e.eventTime).getTime() / 1000),
    event_id: e.id,
    ...(direct
      ? { action_source: "business_messaging", messaging_channel: "whatsapp", user_data: { whatsapp_business_account_id: wabaId, ctwa_clid: e.ctwaClid } }
      : { action_source: "chat", user_data: { ph: [hashPhone(e.contactE164!)] } }),
    custom_data: { currency: "BRL", value: e.valueCents / 100 },
  };
}
