import "server-only";
import { createClient } from "@/lib/supabase/server";

export type ConversationListItem = {
  id: string;
  contact_e164: string;
  contact_name: string;
  status: "aberta" | "encerrada";
  waiting_reply: boolean;
  unread_count: number;
  last_message_at: string | null;
  last_inbound_at: string | null;
  assignee_id: string | null;
  lead: { id: string; name: string } | null;
  tags: { id: string; name: string; color: string }[];
  number_id: string;
  preview: { direction: string; type: string; body: string | null; media_name: string | null; status: string } | null;
};

export type InboxFilters = { q?: string; status?: "abertas" | "aguardando" | "encerradas" | "todas"; responsavel?: string; etiqueta?: string; numero?: string; de?: string; ate?: string };

const PAGE = 50;

/** Conversas paginadas (mais recentes primeiro), nunca todas de uma vez. */
export async function listConversations(f: InboxFilters, userId: string, page = 0) {
  const supabase = await createClient();
  const cols = `id, number_id, contact_e164, contact_name, status, waiting_reply, unread_count, last_message_at, last_inbound_at, assignee_id,
    lead:leads(id, name), conversation_tags(tag:tags(id, name, color))${f.etiqueta ? ", tag_filter:conversation_tags!inner(tag_id)" : ""}`;
  let q = supabase.from("conversations").select(cols, { count: "exact" });
  const status = f.status ?? "abertas";
  if (status === "abertas") q = q.eq("status", "aberta");
  if (status === "aguardando") q = q.eq("status", "aberta").eq("waiting_reply", true);
  if (status === "encerradas") q = q.eq("status", "encerrada");
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

export type Message = {
  id: string;
  direction: "entrada" | "saida" | "nota";
  type: string;
  body: string | null;
  media_id: string | null;
  media_mime: string | null;
  media_name: string | null;
  status: string;
  error: string | null;
  author_id: string | null;
  important: boolean;
  created_at: string;
  wamid: string | null;
  client_ref: string | null;
  reply_to_wamid: string | null;
};

export async function getConversation(id: string) {
  const supabase = await createClient();
  const [conv, msgs] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, number_id, contact_e164, contact_name, status, assignee_id, last_inbound_at, outcome, lead:leads(id, name, company_name, next_contact_at, contact_opt_out_at, whatsapp_consent_at, owner_id), conversation_tags(tag_id)")
      .eq("id", id)
      .maybeSingle(),
    // Últimas 200 mensagens (o suficiente para o atendimento; o histórico completo fica no banco).
    supabase.from("messages").select("id, direction, type, body, media_id, media_mime, media_name, status, error, author_id, important, created_at, wamid, client_ref, reply_to_wamid").eq("conversation_id", id).order("created_at", { ascending: false }).limit(200),
  ]);
  if (conv.error) throw conv.error;
  if (!conv.data) return null;
  const lead = Array.isArray(conv.data.lead) ? conv.data.lead[0] : conv.data.lead;
  return {
    ...conv.data,
    lead: (lead ?? null) as { id: string; name: string; company_name: string | null; next_contact_at: string | null; contact_opt_out_at: string | null; whatsapp_consent_at: string | null; owner_id: string | null } | null,
    tagIds: ((conv.data.conversation_tags as { tag_id: string }[] | null) ?? []).map((t) => t.tag_id),
    messages: ((msgs.data ?? []) as Message[]).reverse(),
    origin: await getConversationOrigin(id),
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
  const [numbers, templates] = await Promise.all([
    supabase.rpc("my_whatsapp_numbers"),
    supabase.from("whatsapp_templates").select("id, name, language, category, status, components").order("name"),
  ]);
  return {
    numbers: (numbers.data ?? []) as { id: string; provider: "cloud" | "waha"; display_phone: string; verified_name: string; status: string; quality: string | null; last_error: string | null }[],
    templates: (templates.data ?? []) as { id: string; name: string; language: string; category: string | null; status: string; components: { type: string; text?: string }[] }[],
  };
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
  const { data } = await supabase.from("conversations").select("id, status, waiting_reply, unread_count, last_message_at").eq("lead_id", leadId).order("last_message_at", { ascending: false, nullsFirst: false }).limit(10);
  return (data ?? []) as { id: string; status: string; waiting_reply: boolean; unread_count: number; last_message_at: string | null }[];
}
