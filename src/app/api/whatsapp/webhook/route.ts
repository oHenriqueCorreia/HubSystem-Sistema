import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOptOut, validSignature, whatsappConfigured } from "@/lib/whatsapp";
import { brPhoneVariants, waIdToE164 } from "@/domain/shared/phone";

export const maxDuration = 60;

/** Verificação do webhook pela Meta (hub.challenge). */
export function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN ?? "";
  const token = q.get("hub.verify_token") ?? "";
  if (q.get("hub.mode") === "subscribe" && expected && token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return new NextResponse(q.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse(null, { status: 403 });
}

type WaMessage = {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  button?: { text: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
  image?: { id: string; mime_type: string; caption?: string };
  document?: { id: string; mime_type: string; filename?: string; caption?: string };
  audio?: { id: string; mime_type: string };
  video?: { id: string; mime_type: string; caption?: string };
  sticker?: { id: string; mime_type: string };
  // Presente na primeira mensagem de quem clicou num anúncio "Clique para WhatsApp".
  referral?: { source_type?: unknown; source_id?: unknown; source_url?: unknown; headline?: unknown; body?: unknown; ctwa_clid?: unknown };
};

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
type WaStatus = { id: string; status: "sent" | "delivered" | "read" | "failed"; errors?: { title?: string; message?: string }[] };
type WaValue = { metadata?: { phone_number_id: string }; contacts?: { wa_id: string; profile?: { name?: string } }[]; messages?: WaMessage[]; statuses?: WaStatus[] };

const STATUS: Record<WaStatus["status"], string> = { sent: "enviada", delivered: "entregue", read: "lida", failed: "erro" };
const KNOWN = new Set(["text", "image", "document", "audio", "video", "sticker", "location", "contacts", "reaction"]);

/**
 * Eventos do WhatsApp. A assinatura X-Hub-Signature-256 é validada sobre o
 * corpo bruto; mensagens e status são idempotentes (wamid único), então
 * reentregas da Meta não duplicam nada. Conteúdo não vai para os logs.
 */
export async function POST(request: NextRequest) {
  if (!whatsappConfigured()) return new NextResponse(null, { status: 503 });
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"))) return new NextResponse(null, { status: 401 });

  let payload: { object?: string; entry?: { changes?: { field: string; value: WaValue }[] }[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (payload.object !== "whatsapp_business_account") return NextResponse.json({ ok: true });

  const admin = createAdminClient();
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const v = change.value;
      const phoneNumberId = v.metadata?.phone_number_id;
      if (!phoneNumberId || !/^\d{5,30}$/.test(phoneNumberId)) continue;
      const { data: number } = await admin.from("whatsapp_numbers").select("id").eq("phone_number_id", phoneNumberId).maybeSingle();
      if (!number) continue;

      for (const m of v.messages ?? []) {
        const from = waIdToE164(m.from);
        if (!from || !/^[\w.=:-]{1,200}$/.test(m.id)) continue;
        const media = m.image ?? m.document ?? m.audio ?? m.video ?? m.sticker;
        const body = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? m.image?.caption ?? m.document?.caption ?? m.video?.caption ?? null;
        const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? "";
        const { data: messageId, error } = await admin.rpc("whatsapp_receive", {
          p_number: number.id,
          p_from: from,
          p_variants: brPhoneVariants(from),
          p_name: name,
          p_wamid: m.id,
          p_type: m.type === "button" || m.type === "interactive" ? "text" : KNOWN.has(m.type) ? m.type : "unsupported",
          p_body: body,
          p_media_id: media?.id ?? null,
          p_media_mime: media?.mime_type ?? null,
          p_media_name: m.document?.filename ?? null,
          p_at: new Date(Number(m.timestamp) * 1000).toISOString(),
          p_opt_out: isOptOut(body),
        });
        if (error) console.error("[whatsapp-webhook] falha ao gravar mensagem", error.code);
        // Origem no anúncio (o banco valida formato e tamanho). messageId nulo = reentrega já processada.
        if (m.referral && messageId) {
          const r = m.referral;
          const { error: refError } = await admin.rpc("whatsapp_referral", {
            p_message: messageId,
            p_source_type: str(r.source_type),
            p_source_id: str(r.source_id),
            p_source_url: str(r.source_url),
            p_headline: str(r.headline),
            p_body: str(r.body),
            p_ctwa_clid: str(r.ctwa_clid),
          });
          if (refError) console.error("[whatsapp-webhook] falha ao gravar origem do anúncio", refError.code);
        }
      }

      for (const s of v.statuses ?? []) {
        if (!STATUS[s.status]) continue;
        const reason = s.errors?.[0]?.title ?? s.errors?.[0]?.message ?? null;
        await admin.rpc("whatsapp_status", { p_wamid: s.id, p_status: STATUS[s.status], p_error: reason });
        if (s.status === "failed") {
          const { data: msg } = await admin.from("messages").select("organization_id, conversation_id").eq("wamid", s.id).maybeSingle();
          if (msg) {
            await admin.rpc("notify_users", {
              p_org: msg.organization_id,
              p_perm: "inbox.manage",
              p_kind: "mensagem_erro",
              p_title: "Uma mensagem do WhatsApp não foi entregue",
              p_body: reason,
              p_href: `/atendimento?conversa=${msg.conversation_id}`,
              p_key: `wa_fail:${s.id}`,
            });
          }
        }
      }
    }
  }
  return NextResponse.json({ ok: true });
}
