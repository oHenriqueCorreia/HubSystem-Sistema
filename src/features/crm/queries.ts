import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { PROSPECTOR_SOURCE, searchIdFromFileName } from "@/domain/crm/prospector";
import type {
  Activity,
  BoardCard,
  CrmLookups,
  Lead,
  LeadListItem,
  Pipeline,
  Stage,
  Tag,
} from "./types";

const PAGE_SIZE = 50;

export type LeadFilters = {
  q?: string;
  segmento?: string;
  etiqueta?: string;
  responsavel?: string;
  status?: string;
  etapa?: string;
  contato?: "atrasado" | "hoje" | "sem";
  ordem?: "recentes" | "nome" | "proximo" | "ultimo";
  pagina?: number;
};

type Row = Record<string, unknown>;

function flattenTags(row: Row): Tag[] {
  const lt = (row.lead_tags as { tag: Tag | Tag[] | null }[] | null) ?? [];
  return lt.flatMap((x) => (Array.isArray(x.tag) ? x.tag : x.tag ? [x.tag] : []));
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

const LIST_COLUMNS = `
  id, name, phone_e164, whatsapp_e164, email, city, state, category, status, owner_id,
  last_contact_at, next_contact_at, created_at, gmb_rating, website,
  segment:segments(id, name),
  lead_tags(tag:tags(id, name, color)),
  deals(id, stage_id, pipeline_id, stage_changed_at)
`;

function toListItem(row: Row, pipelineId?: string): LeadListItem {
  const deals = (row.deals as LeadListItem["deal"][] | null) ?? [];
  const deal = deals.find((d) => d && (!pipelineId || d.pipeline_id === pipelineId)) ?? deals[0] ?? null;
  return {
    ...(row as unknown as LeadListItem),
    segment: one(row.segment as LeadListItem["segment"]),
    tags: flattenTags(row),
    deal,
  };
}

/** Escapa curingas do ILIKE e vírgulas/parênteses usados pelo filtro "or" do PostgREST. */
function safeTerm(q: string) {
  return q.replace(/[%_\\]/g, (c) => `\\${c}`).replace(/[,()]/g, " ").trim();
}

export async function listLeads(filters: LeadFilters, pipelineId?: string, pageSize = PAGE_SIZE) {
  const supabase = await createClient();
  const page = Math.max(1, filters.pagina ?? 1);
  const from = (page - 1) * pageSize;

  const needsTag = Boolean(filters.etiqueta);
  const needsStage = Boolean(filters.etapa);
  const columns = LIST_COLUMNS.replace(
    "lead_tags(tag:tags(id, name, color))",
    needsTag ? "lead_tags!inner(tag_id, tag:tags(id, name, color))" : "lead_tags(tag:tags(id, name, color))",
  ).replace(
    "deals(id, stage_id, pipeline_id, stage_changed_at)",
    needsStage ? "deals!inner(id, stage_id, pipeline_id, stage_changed_at)" : "deals(id, stage_id, pipeline_id, stage_changed_at)",
  );

  let query = supabase.from("leads").select(columns, { count: "exact" }).is("deleted_at", null);

  if (filters.q) {
    const term = safeTerm(filters.q);
    const digits = filters.q.replace(/\D/g, "");
    const ors = [`name.ilike.%${term}%`, `company_name.ilike.%${term}%`, `city.ilike.%${term}%`, `email.ilike.%${term}%`];
    if (digits.length >= 4) ors.push(`phone_e164.ilike.%${digits}%`);
    query = query.or(ors.join(","));
  }
  if (filters.segmento) query = query.eq("segment_id", filters.segmento);
  if (filters.responsavel === "sem") query = query.is("owner_id", null);
  else if (filters.responsavel) query = query.eq("owner_id", filters.responsavel);
  if (filters.status) query = query.eq("status", filters.status);
  if (needsTag) query = query.eq("lead_tags.tag_id", filters.etiqueta!);
  if (needsStage) query = query.eq("deals.stage_id", filters.etapa!).is("deals.deleted_at", null);

  const now = new Date();
  const startOfTomorrow = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now) + "T23:59:59.999-03:00");
  if (filters.contato === "atrasado") query = query.lt("next_contact_at", now.toISOString());
  if (filters.contato === "hoje") query = query.gte("next_contact_at", now.toISOString()).lte("next_contact_at", startOfTomorrow.toISOString());
  if (filters.contato === "sem") query = query.is("next_contact_at", null);

  switch (filters.ordem) {
    case "nome":
      query = query.order("name", { ascending: true });
      break;
    case "proximo":
      query = query.order("next_contact_at", { ascending: true, nullsFirst: false });
      break;
    case "ultimo":
      query = query.order("last_contact_at", { ascending: false, nullsFirst: false });
      break;
    default:
      query = query.order("created_at", { ascending: false });
  }

  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) throw error;
  return {
    rows: (data as unknown as Row[]).map((r) => toListItem(r, pipelineId)),
    total: count ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  };
}

export const getCrmLookups = cache(async (): Promise<CrmLookups> => {
  const supabase = await createClient();
  const [pipelines, stages, segments, tags, owners, reasons, templates, org] = await Promise.all([
    supabase.from("pipelines").select("id, name, position").eq("is_active", true).order("position"),
    supabase.from("stages").select("id, pipeline_id, name, position, color, kind, sla_days").is("archived_at", null).order("position"),
    supabase.from("segments").select("id, name").order("name"),
    supabase.from("tags").select("id, name, color").is("archived_at", null).order("name"),
    supabase.from("profiles").select("id, full_name, email").eq("is_active", true).order("full_name"),
    supabase.from("lost_reasons").select("id, name").order("position"),
    supabase.from("message_templates").select("id, name, body, stage_id").order("position"),
    supabase.from("organizations").select("settings").maybeSingle(),
  ]);

  for (const result of [pipelines, stages, segments, tags, owners, reasons, templates, org]) if (result.error) throw result.error;

  const stageRows = (stages.data ?? []) as Stage[];
  const settings = (org.data?.settings ?? {}) as Record<string, unknown>;
  return {
    pipelines: ((pipelines.data ?? []) as Omit<Pipeline, "stages">[]).map((p) => ({
      ...p,
      stages: stageRows.filter((s) => s.pipeline_id === p.id),
    })),
    segments: segments.data ?? [],
    tags: (tags.data ?? []) as Tag[],
    owners: owners.data ?? [],
    lostReasons: reasons.data ?? [],
    templates: templates.data ?? [],
    whatsappDefault: typeof settings.whatsapp_default_message === "string" ? settings.whatsapp_default_message : "Olá, {nome}!",
  };
});

export async function getLead(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select(
      `*, segment:segments(id, name), lead_tags(tag:tags(id, name, color)),
       deals(id, lead_id, pipeline_id, stage_id, owner_id, amount_cents, billing, position, expected_close_date,
             lost_reason_id, lost_note, won_at, lost_at, stage_changed_at, deleted_at)`,
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as Row;
  const deals = ((row.deals as (BoardCard & { deleted_at: string | null })[]) ?? []).filter((d) => !d.deleted_at);
  return {
    lead: { ...(row as unknown as Lead), segment: one(row.segment as Lead["segment"]), tags: flattenTags(row), deal: deals[0] ?? null } as Lead,
    deals: deals as unknown as BoardCard[],
  };
}

export async function getLeadActivities(leadId: string, limit = 100): Promise<Activity[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activities")
    .select("id, type, content, metadata, occurred_at, created_by, deal_id")
    .eq("lead_id", leadId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Activity[];
}

export async function getBoard(pipelineId: string, filters: Pick<LeadFilters, "q" | "responsavel" | "etiqueta" | "segmento">) {
  const supabase = await createClient();
  let query = supabase
    .from("deals")
    .select(
      `id, lead_id, pipeline_id, stage_id, owner_id, amount_cents, billing, position, expected_close_date,
       lost_reason_id, lost_note, won_at, lost_at, stage_changed_at,
       lead:leads!inner(id, name, address, neighborhood, city, state, place_id, gmb_url, phone_e164, whatsapp_e164, email, source, next_contact_at, last_contact_at, segment_id, deleted_at,
                        lead_tags(tag_id, tag:tags(id, name, color)))`,
    )
    .eq("pipeline_id", pipelineId)
    .is("deleted_at", null)
    .is("lead.deleted_at", null)
    .order("position", { ascending: true })
    .limit(2000);

  if (filters.responsavel === "sem") query = query.is("owner_id", null);
  else if (filters.responsavel) query = query.eq("owner_id", filters.responsavel);
  if (filters.segmento) query = query.eq("lead.segment_id", filters.segmento);
  if (filters.q) query = query.ilike("lead.name", `%${safeTerm(filters.q)}%`);

  const { data, error } = await query;
  if (error) throw error;

  let cards = ((data ?? []) as Row[]).map((r) => {
    const lead = one(r.lead as Row) as Row;
    return { ...(r as unknown as BoardCard), lead: { ...(lead as unknown as BoardCard["lead"]), tags: flattenTags(lead) } };
  });
  if (filters.etiqueta) cards = cards.filter((c) => c.lead.tags.some((t) => t.id === filters.etiqueta));
  return cards;
}

export type ProspectorImports = Record<string, { inserted: number; skipped: number }>;

/** Buscas do prospectador já enviadas ao CRM. Importação desfeita volta a ficar disponível. */
export async function listProspectorImports(): Promise<ProspectorImports> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("imports")
    .select("file_name, inserted, skipped")
    .like("file_name", `${PROSPECTOR_SOURCE} %`)
    .is("undone_at", null)
    .limit(1000);
  if (error) throw error;
  const added: ProspectorImports = {};
  for (const row of data ?? []) {
    const id = searchIdFromFileName(row.file_name);
    if (!id) continue;
    const total = (added[id] ??= { inserted: 0, skipped: 0 });
    total.inserted += row.inserted;
    total.skipped += row.skipped;
  }
  return added;
}

export async function listImports() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("imports")
    .select("id, file_name, total_rows, inserted, updated, skipped, invalid, undone_at, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  return data ?? [];
}
