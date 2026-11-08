import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto";
import { wahaGroupName, wahaProfilePicture, type WahaConn } from "@/lib/waha";

// Fotos de perfil e nomes de grupo: buscados no WhatsApp em segundo plano e guardados na conversa.
// O link da foto expira; por isso cada conversa é conferida de novo depois de alguns dias.

const STALE_MS = 3 * 24 * 3600 * 1000;
const MAX_PER_RUN = 30;

type Row = { id: string; number_id: string; kind: "contato" | "grupo"; contact_e164: string | null; group_jid: string | null; contact_name: string; avatar_checked_at: string | null };

const jidOf = (r: Row) => (r.kind === "grupo" ? r.group_jid : r.contact_e164 ? `${r.contact_e164.replace(/\D/g, "")}@c.us` : null);

/** Atualiza as conversas mostradas na tela que estão sem foto conferida há mais de 3 dias. */
export async function refreshAvatars(conversationIds: string[]) {
  if (!conversationIds.length) return;
  const admin = createAdminClient();
  const since = new Date(Date.now() - STALE_MS).toISOString();
  const { data } = await admin
    .from("conversations")
    .select("id, number_id, kind, contact_e164, group_jid, contact_name, avatar_checked_at")
    .in("id", conversationIds.slice(0, 200))
    .or(`avatar_checked_at.is.null,avatar_checked_at.lt.${since}`)
    .limit(MAX_PER_RUN);
  const rows = (data ?? []) as Row[];
  if (!rows.length) return;

  // Só números por QR Code (WAHA) têm foto pela API; a API oficial da Meta não fornece.
  const numberIds = [...new Set(rows.map((r) => r.number_id))];
  const { data: numbers } = await admin.from("whatsapp_numbers").select("id, provider, status, waha_url, waha_session, token_enc").in("id", numberIds);
  const conns = new Map<string, WahaConn>();
  for (const n of numbers ?? []) {
    if (n.provider === "waha" && n.status === "ativo") conns.set(n.id, { url: n.waha_url as string, key: decrypt(n.token_enc), session: n.waha_session as string });
  }

  const now = new Date().toISOString();
  const work = rows.map((r) => async () => {
    const conn = conns.get(r.number_id);
    const jid = jidOf(r);
    if (!conn || !jid) return admin.from("conversations").update({ avatar_checked_at: now }).eq("id", r.id);
    const [avatar, groupName] = await Promise.all([
      wahaProfilePicture(conn, jid).catch(() => undefined),
      // Grupo renomeado: o nome também é conferido.
      r.kind === "grupo" ? wahaGroupName(conn, jid).catch(() => null) : Promise.resolve(null),
    ]);
    const patch: Record<string, unknown> = { avatar_checked_at: now };
    if (avatar !== undefined) patch.avatar_url = avatar;
    if (groupName && groupName !== r.contact_name) patch.contact_name = groupName.slice(0, 120);
    return admin.from("conversations").update(patch).eq("id", r.id);
  });
  // 5 por vez: rápido sem sobrecarregar o servidor do WhatsApp.
  for (let i = 0; i < work.length; i += 5) await Promise.all(work.slice(i, i + 5).map((w) => w()));
}
