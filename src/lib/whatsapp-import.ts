import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto";
import { wahaChatMessages, wahaChatsOverview, wahaGroupName, wahaLidPhone, type WahaConn } from "@/lib/waha";
import { brPhoneVariants } from "@/domain/shared/phone";
import { chatKind, historyItem, phoneOfJid, type HistoryItem } from "@/domain/whatsapp/waha";

const CHATS_PER_PAGE = 20;
const MESSAGES_PER_PAGE = 100;
/** Limite por conversa: as mais recentes. O banco não comporta anos de mensagens de cada contato. */
export const MAX_MESSAGES_PER_CHAT = 500;
/** O aparelho envia o histórico aos poucos depois do QR Code: passa de novo para pegar o que chegou depois. */
const PASS_WAIT_SECONDS: Record<number, number> = { 1: 120, 2: 300 };
const LAST_PASS = 3;
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
  for (let offset = 0; offset < MAX_MESSAGES_PER_CHAT; offset += MESSAGES_PER_PAGE) {
    const page = await wahaChatMessages(conn, chatId, MESSAGES_PER_PAGE, offset);
    for (const raw of page) {
      const item = historyItem(raw, group ? numberId : null);
      if (item) {
        items.push(item);
        alt ??= item.alt;
      }
    }
    if (page.length < MESSAGES_PER_PAGE) break;
  }
  return { items: items.slice(0, MAX_MESSAGES_PER_CHAT), alt };
}

/** Importa uma conversa. Devolve as mensagens novas, ou null se não der para identificar o contato. */
async function importChat(conn: WahaConn, numberId: string, ownPhone: string, chat: { id: string; name?: string | null }) {
  const admin = createAdminClient();
  const kind = chatKind(chat.id);
  const group = kind === "grupo";
  const { items, alt } = await fetchMessages(conn, chat.id, numberId, group);
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
  const named = chat.name?.trim() ?? "";
  const { data, error } = await admin.rpc("whatsapp_import_chat", { p_number: numberId, p_kind: "contato", p_e164: phone, p_variants: variants, p_group_jid: null, p_name: /^\+?[\d\s-]+$/.test(named) ? "" : named, p_messages: stripAlt(items) });
  if (error) throw new Error("import_rpc");
  return (data as number) ?? 0;
}

/** O telefone alternativo só serve para achar o contato: não vai para o banco. */
const stripAlt = (items: HistoryItem[]) =>
  items.map((item) => {
    const row: Partial<HistoryItem> = { ...item };
    delete row.alt;
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
        const inserted = await importChat(conn, job.number_id, ownPhone, chat);
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
