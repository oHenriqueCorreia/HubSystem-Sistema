import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { MESSAGE_COLUMNS, MESSAGE_PAGE, type Message } from "./message-columns";

export type { Message };

export type ConversationListItem = {
  id: string;
  kind: "contato" | "grupo";
  contact_e164: string | null;
  group_jid: string | null;
  contact_name: string;
  avatar_url: string | null;
  status: "aberta" | "encerrada";
  waiting_reply: boolean;
  unread_count: number;
  last_message_at: string | null;
  last_inbound_at: string | null;
  assignee_id: string | null;
  lead: { id: string; name: string } | null;
  tags: { id: string; name: string; color: string }[];
  number_id: string;
  preview: { direction: string; type: string; body: string | null; media_name: string | null; status: string; sender_name: string | null } | null;
};

export type InboxFilters = { q?: string; status?: "abertas" | "aguardando" | "grupos" | "encerradas" | "todas" | "excluidas"; responsavel?: string; etiqueta?: string; numero?: string; de?: string; ate?: string };

const PAGE = 50;

/** Números da organização, buscados uma vez por página. */
export const myWhatsappNumbers = cache(async () => {
  const supabase = await createClient();
  return supabase.rpc("my_whatsapp_numbers");
});

/** Por QR Code, a conversa só aparece depois de a pessoa compilar. A API oficial não tem essa etapa. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function visibleNumberIds(_supabase?: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await myWhatsappNumbers();
  return ((data ?? []) as { id: string; provider: string; compiled_at: string | null }[]).filter((n) => n.provider !== "waha" || n.compiled_at).map((n) => n.id);
}

/** Conversas paginadas (mais recentes primeiro), nunca todas de uma vez. */
export async function listConversations(f: InboxFilters, userId: string, page = 0) {
  const supabase = await createClient();
  const cols = `id, number_id, kind, contact_e164, group_jid, contact_name, avatar_url, status, waiting_reply, unread_count, last_message_at, last_inbound_at, assignee_id,
    lead:leads(id, name), conversation_tags(tag:tags(id, name, color))${f.etiqueta ? ", tag_filter:conversation_tags!inner(tag_id)" : ""}`;
  let q = supabase.from("conversations").select(cols, { count: "exact" }).in("number_id", await visibleNumberIds(supabase));
  const status = f.status ?? "abertas";
  if (status === "abertas") q = q.eq("status", "aberta");
  if (status === "aguardando") q = q.eq("status", "aberta").eq("waiting_reply", true);
  if (status === "encerradas") q = q.eq("status", "encerrada");
  if (status === "grupos") q = q.eq("kind", "grupo");
  if (status === "excluidas") q = q.not("excluded_at", "is", null);
  else q = q.is("excluded_at", null);
  if (f.responsavel === "eu") q = q.eq("assignee_id", userId);
  else if (f.responsavel === "sem") q = q.is("assignee_id", null);
  else if (f.responsavel) q = q.eq("assignee_id", f.responsavel);
  if (f.numero) q = q.eq("number_id", f.numero);
  if (f.etiqueta) q = q.eq("tag_filter.tag_id", f.etiqueta);
  if (f.de) q = q.gte("last_message_at", `${f.de}T00:00:00-03:00`);
  if (f.ate) q = q.lte("last_message_at", `${f.ate}T23:59:59-03:00`);
  if (f.q) {
    const term = f.q.replace(/[%_,()\\]/g, " ").trim();
    const digits = term.replace(/\D/g, "");
    q = q.or([`contact_name.ilike.%${term}%`, ...(digits.length >= 4 ? [`contact_e164.like.%${digits}%`] : [])].join(","));
  }
  const { data, error, count } = await q
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .range(page * PAGE, page * PAGE + PAGE - 1);
  if (error) throw error;
  const one = <T,>(v: T | T[] | null) => (Array.isArray(v) ? (v[0] ?? null) : v);
  const items = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as ConversationListItem),
    lead: one(r.lead as ConversationListItem["lead"] | ConversationListItem["lead"][]),
    tags: ((r.conversation_tags as { tag: ConversationListItem["tags"][number] | null }[] | null) ?? []).flatMap((t) => (t.tag ? [t.tag] : [])),
  }));
  // Última mensagem de cada conversa, para a lista mostrar como no WhatsApp.
  const { data: previews } = items.length ? await supabase.rpc("conversation_previews", { p_ids: items.map((i) => i.id) }) : { data: [] };
  const byId = new Map(((previews ?? []) as (NonNullable<ConversationListItem["preview"]> & { conversation_id: string })[]).map((p) => [p.conversation_id, p]));
  return { items: items.map((i) => ({ ...i, preview: byId.get(i.id) ?? null })), total: count ?? items.length, hasMore: (count ?? 0) > (page + 1) * PAGE };
}

export async function getConversation(id: string) {
  const supabase = await createClient();
  const [conv, msgs, visible, origin] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, number_id, kind, contact_e164, group_jid, client_id, excluded_at, contact_name, avatar_url, status, assignee_id, last_inbound_at, outcome, lead:leads(id, name, company_name, email, notes, next_contact_at, contact_opt_out_at, whatsapp_consent_at, owner_id), conversation_tags(tag_id)")
      .eq("id", id)
      .maybeSingle(),
    // Últimas mensagens; as anteriores carregam sob demanda na própria conversa.
    supabase.from("messages").select(MESSAGE_COLUMNS).eq("conversation_id", id).order("created_at", { ascending: false }).limit(MESSAGE_PAGE),
    visibleNumberIds(supabase),
    getConversationOrigin(id),
  ]);
  if (conv.error) throw conv.error;
  if (!conv.data) return null;
  if (conv.data.excluded_at || !visible.includes(conv.data.number_id as string)) return null;
  const lead = Array.isArray(conv.data.lead) ? conv.data.lead[0] : conv.data.lead;
  return {
    ...conv.data,
    lead: (lead ?? null) as { id: string; name: string; company_name: string | null; email: string | null; notes: string | null; next_contact_at: string | null; contact_opt_out_at: string | null; whatsapp_consent_at: string | null; owner_id: string | null } | null,
    tagIds: ((conv.data.conversation_tags as { tag_id: string }[] | null) ?? []).map((t) => t.tag_id),
    messages: ((msgs.data ?? []) as unknown as Message[]).reverse(),
    hasOlder: (msgs.data ?? []).length === MESSAGE_PAGE,
    origin,
  };
}

export type ConversationOrigin = { kind: "ad" | "post" | "outro"; title: string; campaignId: string | null; campaignName: string | null; url: string | null; at: string };

/** Primeiro anúncio ou publicação que trouxe a conversa (Clique para WhatsApp). Complementar: sem dados, devolve null. */
async function getConversationOrigin(conversationId: string): Promise<ConversationOrigin | null> {
  const supabase = await createClient();
  const { data: ref } = await supabase
    .from("ad_referrals")
    .select("source_type, source_id, source_url, headline, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!ref) return null;
  // O nome do anúncio e a campanha só aparecem para quem pode ver Anúncios (RLS).
  const { data: ad } = ref.source_id
    ? await supabase.from("ads").select("name, campaign_id, ad_campaigns(name)").eq("external_id", ref.source_id).limit(1).maybeSingle()
    : { data: null };
  const campaign = ad ? ((Array.isArray(ad.ad_campaigns) ? ad.ad_campaigns[0] : ad.ad_campaigns) as { name: string } | null) : null;
  return {
    kind: ref.source_type as ConversationOrigin["kind"],
    title: ad?.name ?? ref.headline ?? (ref.source_type === "post" ? "Publicação da Meta" : "Anúncio da Meta"),
    campaignId: ad?.campaign_id ?? null,
    campaignName: campaign?.name ?? null,
    url: ref.source_url,
    at: ref.created_at,
  };
}

export async function getInboxSetup() {
  const supabase = await createClient();
  const [numbers, templates, imports, finished] = await Promise.all([
    myWhatsappNumbers(),
    supabase.from("whatsapp_templates").select("id, name, language, category, status, components").order("name"),
    supabase.from("whatsapp_imports").select("number_id, contacts_done, groups_done, messages_done").in("status", ["importando", "aguardando"]),
    supabase.from("whatsapp_imports").select("number_id").eq("status", "concluida"),
  ]);
  return {
    numbers: (numbers.data ?? []) as { id: string; provider: "cloud" | "waha"; display_phone: string; verified_name: string; status: string; quality: string | null; last_error: string | null; compiled_at: string | null }[],
    templates: (templates.data ?? []) as { id: string; name: string; language: string; category: string | null; status: string; components: { type: string; text?: string }[] }[],
    activeImports: (imports.data ?? []) as { number_id: string; contacts_done: number; groups_done: number; messages_done: number }[],
    importedNumbers: ((finished.data ?? []) as { number_id: string }[]).map((j) => j.number_id),
  };
}

/** Clientes para ligar a um grupo ou conversa. */
export async function listClientOptions() {
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("id, legal_name, lead:leads(name)").order("legal_name").limit(500);
  return ((data ?? []) as unknown as { id: string; legal_name: string | null; lead: { name: string } | { name: string }[] | null }[]).map((c) => ({ id: c.id, name: c.legal_name || (Array.isArray(c.lead) ? c.lead[0]?.name : c.lead?.name) || "Cliente sem nome" }));
}

/** Quantos grupos estão na lista, para o "manter só os marcados" dizer quantos saem. */
export async function countGroups(numberId?: string) {
  const supabase = await createClient();
  let q = supabase.from("conversations").select("id", { count: "exact", head: true }).in("number_id", await visibleNumberIds(supabase)).eq("kind", "grupo").is("excluded_at", null);
  if (numberId) q = q.eq("number_id", numberId);
  const { count } = await q;
  return count ?? 0;
}

export async function listQuickReplies() {
  const supabase = await createClient();
  const { data } = await supabase.from("quick_replies").select("id, shortcut, body").order("shortcut");
  return (data ?? []) as { id: string; shortcut: string; body: string }[];
}

/** Negócios do lead com as etapas de cada funil, para mudar de etapa dentro da conversa. */
export async function listLeadDeals(leadId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("deals").select("id, stage_id, pipeline_id").eq("lead_id", leadId);
  return (data ?? []) as { id: string; stage_id: string; pipeline_id: string }[];
}

/** Conversas de um lead (para o painel do lead). */
export async function listLeadConversations(leadId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("conversations").select("id, status, waiting_reply, unread_count, last_message_at").eq("lead_id", leadId).is("excluded_at", null).order("last_message_at", { ascending: false, nullsFirst: false }).limit(10);
  return (data ?? []) as { id: string; status: string; waiting_reply: boolean; unread_count: number; last_message_at: string | null }[];
}
