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
};

export type InboxFilters = { q?: string; status?: "abertas" | "aguardando" | "encerradas" | "todas"; responsavel?: string; etiqueta?: string; numero?: string; de?: string; ate?: string };

const PAGE = 50;

/** Conversas paginadas (mais recentes primeiro), nunca todas de uma vez. */
export async function listConversations(f: InboxFilters, userId: string, page = 0) {
  const supabase = await createClient();
  const cols = `id, contact_e164, contact_name, status, waiting_reply, unread_count, last_message_at, last_inbound_at, assignee_id,
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
  return { items, total: count ?? items.length, hasMore: (count ?? 0) > (page + 1) * PAGE };
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
};

export async function getConversation(id: string) {
  const supabase = await createClient();
  const [conv, msgs] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, number_id, contact_e164, contact_name, status, assignee_id, last_inbound_at, outcome, lead:leads(id, name, contact_opt_out_at, whatsapp_consent_at, owner_id), conversation_tags(tag_id)")
      .eq("id", id)
      .maybeSingle(),
    // Últimas 200 mensagens (o suficiente para o atendimento; o histórico completo fica no banco).
    supabase.from("messages").select("id, direction, type, body, media_id, media_mime, media_name, status, error, author_id, important, created_at").eq("conversation_id", id).order("created_at", { ascending: false }).limit(200),
  ]);
  if (conv.error) throw conv.error;
  if (!conv.data) return null;
  const lead = Array.isArray(conv.data.lead) ? conv.data.lead[0] : conv.data.lead;
  return {
    ...conv.data,
    lead: (lead ?? null) as { id: string; name: string; contact_opt_out_at: string | null; whatsapp_consent_at: string | null; owner_id: string | null } | null,
    tagIds: ((conv.data.conversation_tags as { tag_id: string }[] | null) ?? []).map((t) => t.tag_id),
    messages: ((msgs.data ?? []) as Message[]).reverse(),
  };
}

export async function getInboxSetup() {
  const supabase = await createClient();
  const [numbers, templates] = await Promise.all([
    supabase.rpc("my_whatsapp_numbers"),
    supabase.from("whatsapp_templates").select("id, name, language, category, status, components").order("name"),
  ]);
  return {
    numbers: (numbers.data ?? []) as { id: string; display_phone: string; verified_name: string; status: string; quality: string | null; last_error: string | null }[],
    templates: (templates.data ?? []) as { id: string; name: string; language: string; category: string | null; status: string; components: { type: string; text?: string }[] }[],
  };
}

/** Conversas de um lead (para o painel do lead). */
export async function listLeadConversations(leadId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("conversations").select("id, status, waiting_reply, unread_count, last_message_at").eq("lead_id", leadId).order("last_message_at", { ascending: false, nullsFirst: false }).limit(10);
  return (data ?? []) as { id: string; status: string; waiting_reply: boolean; unread_count: number; last_message_at: string | null }[];
}
