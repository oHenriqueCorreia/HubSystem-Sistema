import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto";
import { isOptOut } from "@/lib/whatsapp";
import { validWahaSignature, wahaDownload, wahaGroupName } from "@/lib/waha";
import { brPhoneVariants } from "@/domain/shared/phone";
import { bareMessageId, displayPhoneFromMe, parseWahaEvent, scopedWamid, type WahaMedia } from "@/domain/whatsapp/waha";

export const maxDuration = 60;

const SESSION_STATUS: Record<string, string> = { WORKING: "ativo", SCAN_QR_CODE: "aguardando_qr", STARTING: "aguardando_qr", FAILED: "erro", STOPPED: "erro" };

/** Guarda a mídia no nosso armazenamento (o arquivo do servidor WAHA expira). */
async function storeMedia(conn: { url: string; key: string }, organizationId: string, numberId: string, wamid: string, media: WahaMedia) {
  const admin = createAdminClient();
  const body = await wahaDownload(conn, media.url);
  const path = `${organizationId}/${numberId}/${wamid}`;
  const { error } = await admin.storage.from("whatsapp-media").upload(path, body, { contentType: media.mime, upsert: true });
  if (error) throw error;
  return `storage:${path}`;
}

/**
 * Eventos do WhatsApp por QR Code. Fechado por padrão: sem assinatura válida
 * (HMAC-SHA512 com o segredo desta sessão), nada é processado. Mensagens são
 * idempotentes pelo id, e o conteúdo não vai para os logs.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ numberId: string }> }) {
  const { numberId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(numberId)) return new NextResponse(null, { status: 404 });
  const raw = await request.text();

  const admin = createAdminClient();
  const { data: number } = await admin.from("whatsapp_numbers").select("id, organization_id, provider, status, webhook_secret_enc, waha_url, waha_session, token_enc").eq("id", numberId).maybeSingle();
  if (!number || number.provider !== "waha" || !number.webhook_secret_enc) return new NextResponse(null, { status: 404 });

  let secret = "";
  try {
    secret = decrypt(number.webhook_secret_enc);
  } catch {
    return new NextResponse(null, { status: 401 });
  }
  if (!validWahaSignature(raw, request.headers.get("x-webhook-hmac"), secret)) return new NextResponse(null, { status: 401 });

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const event = parseWahaEvent(json);
  if (number.status === "desconectado") return NextResponse.json({ ok: true });

  if (event.kind === "session") {
    const status = SESSION_STATUS[event.status];
    if (status) {
      const phone = displayPhoneFromMe(event.meId);
      await admin
        .from("whatsapp_numbers")
        .update({
          status,
          last_error: event.status === "FAILED" ? "A conexão caiu. Clique em Reconectar e escaneie o QR Code de novo." : null,
          updated_at: new Date().toISOString(),
          ...(phone ? { display_phone: phone } : {}),
          ...(event.meName ? { verified_name: event.meName } : {}),
        })
        .eq("id", number.id);
      if (event.status === "FAILED") {
        await admin.rpc("notify_users", {
          p_org: number.organization_id,
          p_perm: "inbox.manage",
          p_kind: "whatsapp_desconectado",
          p_title: "O WhatsApp por QR Code desconectou",
          p_body: "Abra o Atendimento e escaneie o QR Code de novo para voltar a receber mensagens.",
          p_href: "/atendimento",
          p_key: `waha_falha:${number.id}:${new Date().toISOString().slice(0, 13)}`,
        });
      }
    }
    return NextResponse.json({ ok: true });
  }

  if (event.kind === "ack") {
    await admin.rpc("whatsapp_status", { p_wamid: event.group ? scopedWamid(number.id, event.wamid) : event.wamid, p_status: event.status, p_error: null });
    return NextResponse.json({ ok: true });
  }

  if (event.kind === "group_message") {
    const wamid = scopedWamid(number.id, event.wamid);
    const { data: known } = await admin.from("messages").select("id").eq("wamid", wamid).maybeSingle();
    if (known) return NextResponse.json({ ok: true });
    const conn = { url: number.waha_url as string, key: decrypt(number.token_enc) };
    let mediaId: string | null = null;
    if (event.media) {
      try {
        mediaId = await storeMedia(conn, number.organization_id, number.id, event.wamid, event.media);
      } catch {
        console.error("[waha-webhook] falha ao guardar mídia");
      }
    }
    // O nome do grupo não vem na mensagem: busca uma vez, na primeira.
    const { data: existing } = await admin.from("conversations").select("contact_name").eq("number_id", number.id).eq("group_jid", event.groupJid).maybeSingle();
    const groupName = existing?.contact_name ? null : await wahaGroupName({ ...conn, session: number.waha_session as string }, event.groupJid).catch(() => null);
    const { error } = await admin.rpc("whatsapp_group_message", {
      p_number: number.id,
      p_group_jid: event.groupJid,
      p_group_name: groupName,
      p_wamid: wamid,
      p_from_me: event.fromMe,
      p_type: event.type,
      p_body: event.body,
      p_media_id: mediaId,
      p_media_mime: event.media?.mime ?? null,
      p_media_name: event.media?.name ?? null,
      p_at: event.at,
      p_sender_jid: event.senderJid,
      p_sender_name: event.senderName || null,
      p_reply_to: event.replyTo ? scopedWamid(number.id, bareMessageId(event.replyTo)) : null,
    });
    if (error) console.error("[waha-webhook] falha ao gravar mensagem de grupo", error.code);
    return NextResponse.json({ ok: true });
  }

  if (event.kind === "message") {
    // Reentrega ou eco de um envio do próprio sistema: a mensagem já está gravada.
    const { data: known } = await admin.from("messages").select("id").eq("wamid", event.wamid).maybeSingle();
    if (known) return NextResponse.json({ ok: true });
    let mediaId: string | null = null;
    if (event.media) {
      try {
        mediaId = await storeMedia({ url: number.waha_url as string, key: decrypt(number.token_enc) }, number.organization_id, number.id, event.wamid, event.media);
      } catch {
        console.error("[waha-webhook] falha ao guardar mídia");
      }
    }
    const variants = brPhoneVariants(event.phone);
    const common = { p_number: number.id, p_variants: variants, p_name: event.name, p_wamid: event.wamid, p_type: event.type, p_body: event.body, p_media_id: mediaId, p_media_mime: event.media?.mime ?? null, p_media_name: event.media?.name ?? null, p_at: event.at };
    if (event.fromMe) {
      const { error } = await admin.rpc("whatsapp_record_outgoing", { ...common, p_to: event.phone });
      if (error) console.error("[waha-webhook] falha ao gravar envio", error.code);
    } else {
      const { data: messageId, error } = await admin.rpc("whatsapp_receive", { ...common, p_from: event.phone, p_opt_out: isOptOut(event.body) });
      if (error) console.error("[waha-webhook] falha ao gravar mensagem", error.code);
      const quoted = (json as { payload?: { replyTo?: { id?: unknown } } }).payload?.replyTo?.id;
      if (messageId && typeof quoted === "string" && quoted) await admin.from("messages").update({ reply_to_wamid: bareMessageId(quoted) }).eq("id", messageId);
      if (event.referral && messageId) {
        const r = event.referral;
        await admin.rpc("whatsapp_referral", { p_message: messageId, p_source_type: r.source_type, p_source_id: r.source_id, p_source_url: r.source_url, p_headline: r.headline, p_body: r.body, p_ctwa_clid: r.ctwa_clid });
      }
    }
  }
  return NextResponse.json({ ok: true });
}
