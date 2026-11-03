import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto";
import { wahaChatMessages, wahaChatsOverview, wahaGroupName, wahaLidPhone, wahaSession, type WahaConn } from "@/lib/waha";
import { brPhoneVariants } from "@/domain/shared/phone";
import { chatKind, historyItem, phoneOfJid, type HistoryItem } from "@/domain/whatsapp/waha";

const CHATS_PER_PAGE = 20;
const MESSAGES_PER_PAGE = 100;
/** Limite por conversa: as mais recentes. O banco não comporta anos de mensagens de cada contato. */
export const MAX_MESSAGES_PER_CHAT = 500;
/** O aparelho envia o histórico aos poucos depois do QR Code: passa de novo para pegar o que chegou depois. */
const PASS_WAIT_SECONDS: Record<number, number> = { 1: 120, 2: 300, 3: 600 };
const LAST_PASS = 4;
/** Uma conversa com problema é pulada; várias seguidas indicam servidor fora do ar. */
const MAX_FAILURES_IN_A_ROW = 3;
const LEASE_SECONDS = 90;
const GIVE_UP_MS = 2 * 3600_000;
const STORE_OFF = "Este número foi conectado antes de ligar o histórico. Leia o QR Code de novo para compilar.";

type Job = { id: string; organization_id: string; number_id: string; status: string; include_contacts: boolean; include_groups: boolean; pass: number; next_offset: number; skipped: number; messages_done: number; created_at: string };

const isStoreOff = (e: unknown) => {
  const err = e as { status?: number; detail?: string };
  return err.status === 400 && /store/i.test(err.detail ?? "");
};

async function fetchMessages(conn: WahaConn, chatId: string, numberId: string, group: boolean) {
  const items: HistoryItem[] = [];
  let alt: string | null = null;
  let pushName: string | null = null;
  for (let offset = 0; offset < MAX_MESSAGES_PER_CHAT; offset += MESSAGES_PER_PAGE) {
    const page = await wahaChatMessages(conn, chatId, MESSAGES_PER_PAGE, offset);
    for (const raw of page) {
      const item = historyItem(raw, group ? numberId : null);
      if (item) {
        items.push(item);
        alt ??= item.alt;
        pushName ??= item.push_name;
      }
    }
    if (page.length < MESSAGES_PER_PAGE) break;
  }
  return { items: items.slice(0, MAX_MESSAGES_PER_CHAT), alt, pushName };
}

/** Importa uma conversa. Devolve as mensagens novas, ou null se não der para identificar o contato. */
async function importChat(conn: WahaConn, numberId: string, ownPhone: string, chat: { id: string; name?: string | null }) {
  const admin = createAdminClient();
  const kind = chatKind(chat.id);
  const group = kind === "grupo";
  // Grupo excluído continua de fora: compilar de novo não traz de volta.
  if (group) {
    const { data: existing } = await admin.from("conversations").select("excluded_at").eq("number_id", numberId).eq("group_jid", chat.id).maybeSingle();
    if (existing?.excluded_at) return 0;
  }
  const { items, alt, pushName } = await fetchMessages(conn, chat.id, numberId, group);
  if (group) {
    const name = chat.name?.trim() || (await wahaGroupName(conn, chat.id).catch(() => null)) || "";
    const { data, error } = await admin.rpc("whatsapp_import_chat", { p_number: numberId, p_kind: "grupo", p_e164: null, p_variants: null, p_group_jid: chat.id, p_name: name, p_messages: stripAlt(items) });
    if (error) throw new Error("import_rpc");
    return (data as number) ?? 0;
  }
  // Contato com id oculto (@lid): o telefone vem da chave da mensagem ou do mapa do servidor.
  const phone = phoneOfJid(chat.id) ?? phoneOfJid(alt) ?? phoneOfJid(chat.id.endsWith("@lid") ? await wahaLidPhone(conn, chat.id).catch(() => null) : null);
  if (!phone) return null;
  const variants = brPhoneVariants(phone);
  if (ownPhone && variants.includes(ownPhone)) return 0;
  const { data: gone } = await admin.from("conversations").select("excluded_at").eq("number_id", numberId).in("contact_e164", variants).limit(1).maybeSingle();
  if (gone?.excluded_at) return 0;
  const named = chat.name?.trim() ?? "";
  const { data, error } = await admin.rpc("whatsapp_import_chat", { p_number: numberId, p_kind: "contato", p_e164: phone, p_variants: variants, p_group_jid: null, p_name: named && !/^\+?[\d\s-]+$/.test(named) ? named : (pushName ?? ""), p_messages: stripAlt(items) });
  if (error) throw new Error("import_rpc");
  return (data as number) ?? 0;
}

/** O telefone alternativo só serve para achar o contato: não vai para o banco. */
const stripAlt = (items: HistoryItem[]) =>
  items.map((item) => {
    const row: Partial<HistoryItem> = { ...item };
    delete row.alt;
    delete row.push_name;
    return row;
  });

async function claim(jobId: string) {
  const now = new Date().toISOString();
  const { data } = await createAdminClient()
    .from("whatsapp_imports")
    .update({ lease_until: new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(), status: "importando", updated_at: now })
    .eq("id", jobId)
    .in("status", ["importando", "aguardando"])
    .lte("not_before", now)
    .or(`lease_until.is.null,lease_until.lt.${now}`)
    .select("id, organization_id, number_id, status, include_contacts, include_groups, pass, next_offset, skipped, messages_done, created_at")
    .maybeSingle();
  return data as Job | null;
}

async function counts(numberId: string) {
  const admin = createAdminClient();
  const of = (kind: string) => admin.from("conversations").select("id", { count: "exact", head: true }).eq("number_id", numberId).eq("kind", kind).not("imported_at", "is", null);
  const [contacts, groups] = await Promise.all([of("contato"), of("grupo")]);
  return { contacts_done: contacts.count ?? 0, groups_done: groups.count ?? 0 };
}

/** Uma etapa da importação, dentro do tempo dado. A próxima continua de onde esta parou. */
export async function runImportStep(jobId: string, budgetMs: number) {
  const admin = createAdminClient();
  const job = await claim(jobId);
  if (!job) return;
  const deadline = Date.now() + budgetMs;
  const state = { offset: job.next_offset, skipped: job.skipped, messages: job.messages_done };
  const save = async (patch: Record<string, unknown>) => {
    await admin
      .from("whatsapp_imports")
      .update({ next_offset: state.offset, skipped: state.skipped, messages_done: state.messages, lease_until: null, updated_at: new Date().toISOString(), ...(await counts(job.number_id)), ...patch })
      .eq("id", job.id);
  };
  const retryLater = (message: string) =>
    Date.now() - new Date(job.created_at).getTime() > GIVE_UP_MS
      ? save({ status: "erro", last_error: message, finished_at: new Date().toISOString() })
      : save({ last_error: message, not_before: new Date(Date.now() + 60_000).toISOString() });

  const { data: number } = await admin.from("whatsapp_numbers").select("status, provider, waha_url, waha_session, token_enc, display_phone").eq("id", job.number_id).maybeSingle();
  if (!number || number.provider !== "waha") return save({ status: "erro", last_error: "Este número não permite compilar conversas.", finished_at: new Date().toISOString() });
  if (number.status !== "ativo") return retryLater("O WhatsApp está desconectado. A compilação continua quando ele voltar.");
  const conn: WahaConn = { url: number.waha_url as string, key: decrypt(number.token_enc), session: number.waha_session as string };
  const ownPhone = (number.display_phone as string | null) ?? "";

  let failures = 0;
  try {
    while (Date.now() < deadline) {
      const page = await wahaChatsOverview(conn, CHATS_PER_PAGE, state.offset);
      if (!page.length) {
        if (job.pass >= LAST_PASS) {
          await save({ status: "concluida", last_error: null, finished_at: new Date().toISOString() });
          await admin.rpc("notify_users", { p_org: job.organization_id, p_perm: "inbox.manage", p_kind: "whatsapp_historico", p_title: "Conversas compiladas", p_body: `${state.messages.toLocaleString("pt-BR")} mensagens do histórico já estão no Atendimento.`, p_href: "/atendimento", p_key: `whatsapp_historico:${job.id}` });
          return;
        }
        state.offset = 0;
        return await save({ status: "aguardando", pass: job.pass + 1, last_error: null, not_before: new Date(Date.now() + PASS_WAIT_SECONDS[job.pass] * 1000).toISOString() });
      }
      for (const chat of page) {
        if (Date.now() >= deadline) return await save({ last_error: null });
        const kind = chatKind(chat.id);
        if (kind === "ignorar" || (kind === "grupo" && !job.include_groups) || (kind === "contato" && !job.include_contacts)) {
          state.offset++;
          continue;
        }
        let inserted: number | null;
        try {
          inserted = await importChat(conn, job.number_id, ownPhone, chat);
          failures = 0;
        } catch (e) {
          if (isStoreOff(e) || ++failures >= MAX_FAILURES_IN_A_ROW) throw e;
          // Sem isto, uma única conversa com problema travaria a compilação inteira nesse ponto.
          console.error("[whatsapp-import] conversa pulada");
          inserted = null;
        }
        if (inserted === null) {
          if (job.pass === 1) state.skipped++;
        } else {
          state.messages += inserted;
        }
        state.offset++;
      }
      await save({ last_error: null, lease_until: new Date(Date.now() + LEASE_SECONDS * 1000).toISOString() });
    }
    await save({ last_error: null });
  } catch (e) {
    if (isStoreOff(e)) return save({ status: "erro", last_error: STORE_OFF, finished_at: new Date().toISOString() });
    console.error("[whatsapp-import] falha em uma etapa");
    await retryLater("Não foi possível falar com o servidor do WhatsApp. Tentando de novo em instantes.");
  }
}

/** Continua as importações em segundo plano, mesmo com a tela fechada. */
export async function runWhatsAppImports(deadline: number) {
  const { data } = await createAdminClient().from("whatsapp_imports").select("id").in("status", ["importando", "aguardando"]).lte("not_before", new Date().toISOString()).order("updated_at").limit(3);
  for (const job of data ?? []) {
    const left = deadline - Date.now();
    if (left < 8000) return;
    await runImportStep(job.id as string, Math.min(left - 5000, 15_000));
  }
}

/**
 * Reconexão pode deixar o número marcado como "aguardando QR Code" com o aparelho já conectado.
 * Confere no servidor e devolve a verdade, para o envio não ficar bloqueado à toa.
 */
export async function healQrNumbers() {
  const admin = createAdminClient();
  const { data } = await admin.from("whatsapp_numbers").select("id, waha_url, waha_session, token_enc").eq("provider", "waha").eq("status", "aguardando_qr").limit(10);
  for (const n of data ?? []) {
    const session = await wahaSession({ url: n.waha_url as string, key: decrypt(n.token_enc), session: n.waha_session as string }).catch(() => null);
    if (session?.status === "WORKING") await admin.from("whatsapp_numbers").update({ status: "ativo", last_error: null, updated_at: new Date().toISOString() }).eq("id", n.id).eq("status", "aguardando_qr");
  }
}

const PURGE_BATCH = 50;

/**
 * Apaga conversas, mensagens e arquivos de um número desconectado, em lotes.
 * Leads, negócios e etiquetas ficam. Se o tempo acabar, a rodada automática termina o serviço.
 */
export async function purgeNumberData(numberId: string, budgetMs: number) {
  const admin = createAdminClient();
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const { data: batch } = await admin.from("conversations").select("id").eq("number_id", numberId).limit(PURGE_BATCH);
    if (!batch?.length) {
      await admin.from("whatsapp_imports").delete().eq("number_id", numberId);
      await admin.from("whatsapp_numbers").update({ purge_pending: false, updated_at: new Date().toISOString() }).eq("id", numberId);
      return true;
    }
    const ids = batch.map((c) => c.id as string);
    for (let more = true; more && Date.now() < deadline; ) {
      const { data: files } = await admin.from("messages").select("id, media_id").in("conversation_id", ids).like("media_id", "storage:%").limit(500);
      const paths = (files ?? []).map((m) => (m.media_id as string).slice("storage:".length));
      if (paths.length) await admin.storage.from("whatsapp-media").remove(paths).catch(() => null);
      if (files?.length) await admin.from("messages").update({ media_id: null }).in("id", files.map((m) => m.id as string));
      more = (files?.length ?? 0) === 500;
    }
    await admin.from("conversations").delete().in("id", ids);
  }
  return false;
}

export async function runNumberPurges(deadline: number) {
  const { data } = await createAdminClient().from("whatsapp_numbers").select("id").eq("purge_pending", true).limit(3);
  for (const n of data ?? []) {
    const left = deadline - Date.now();
    if (left < 6000) return;
    await purgeNumberData(n.id as string, Math.min(left - 4000, 15_000));
  }
}
