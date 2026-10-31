export type StageKind = "open" | "won" | "lost";
export type LeadStatus = "ativo" | "cliente" | "descartado";
export type ActivityType =
  | "nota"
  | "whatsapp"
  | "ligacao"
  | "email"
  | "reuniao"
  | "mudanca_etapa"
  | "importacao"
  | "tarefa"
  | "sistema";

export type TagColor = "slate" | "teal" | "blue" | "violet" | "rose" | "amber" | "green" | "orange";

export type Stage = { id: string; pipeline_id: string; name: string; position: number; color: TagColor; kind: StageKind; sla_days: number | null };
export type Pipeline = { id: string; name: string; position: number; stages: Stage[] };
export type Tag = { id: string; name: string; color: TagColor };
export type Segment = { id: string; name: string };
export type Owner = { id: string; full_name: string; email: string };
export type LostReason = { id: string; name: string };
export type MessageTemplate = { id: string; name: string; body: string; stage_id: string | null };

export type LeadListItem = {
  id: string;
  name: string;
  phone_e164: string | null;
  whatsapp_e164: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  category: string | null;
  status: LeadStatus;
  owner_id: string | null;
  last_contact_at: string | null;
  next_contact_at: string | null;
  created_at: string;
  gmb_rating: number | null;
  website: string | null;
  segment: Segment | null;
  tags: Tag[];
  deal: { id: string; stage_id: string; pipeline_id: string; stage_changed_at: string } | null;
};

export type Lead = LeadListItem & {
  company_name: string | null;
  phone_raw: string | null;
  phone_type: string | null;
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
  address: string | null;
  neighborhood: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  place_id: string | null;
  gmb_url: string | null;
  gmb_reviews_count: number | null;
  segment_id: string | null;
  source: string | null;
  services_interest: string[];
  notes: string | null;
  updated_at: string;
};

export type Deal = {
  id: string;
  lead_id: string;
  pipeline_id: string;
  stage_id: string;
  owner_id: string | null;
  amount_cents: number | null;
  billing: "unico" | "mensal" | null;
  position: number;
  expected_close_date: string | null;
  lost_reason_id: string | null;
  lost_note: string | null;
  won_at: string | null;
  lost_at: string | null;
  stage_changed_at: string;
};

export type BoardCard = Deal & {
  lead: Pick<Lead, "id" | "name" | "address" | "neighborhood" | "city" | "state" | "place_id" | "gmb_url" | "phone_e164" | "whatsapp_e164" | "next_contact_at" | "last_contact_at"> & {
    tags: Tag[];
  };
};

export type Activity = {
  id: string;
  type: ActivityType;
  content: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
  created_by: string | null;
  deal_id: string | null;
};

export type CrmLookups = {
  pipelines: Pipeline[];
  segments: Segment[];
  tags: Tag[];
  owners: Owner[];
  lostReasons: LostReason[];
  templates: MessageTemplate[];
  whatsappDefault: string;
};

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  nota: "Nota",
  whatsapp: "WhatsApp",
  ligacao: "Ligação",
  email: "E-mail",
  reuniao: "Reunião",
  mudanca_etapa: "Mudança de etapa",
  importacao: "Importação",
  tarefa: "Tarefa",
  sistema: "Sistema",
};

export const SERVICE_OPTIONS = [
  "Criação de site",
  "Manutenção de site",
  "Meta Ads",
  "Google Ads",
  "Google Meu Negócio",
  "Outros",
] as const;

/** Situação do próximo contato (usa cor + ícone + texto na interface). */
export type NextContactState = "none" | "overdue" | "today" | "upcoming";

export function nextContactState(iso: string | null, now = new Date()): NextContactState {
  if (!iso) return "none";
  const d = new Date(iso);
  const fmt = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(x);
  const day = fmt(d);
  const today = fmt(now);
  if (day < today) return "overdue";
  if (day === today) return d.getTime() < now.getTime() ? "overdue" : "today";
  return "upcoming";
}

/** Negócio parado além do SLA da etapa. */
export function isStale(stageChangedAt: string, slaDays: number | null, now = new Date()): boolean {
  if (!slaDays) return false;
  return now.getTime() - new Date(stageChangedAt).getTime() > slaDays * 86_400_000;
}

/** Posição entre dois vizinhos para reordenar sem reescrever a coluna inteira. */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1024;
  if (before === null) return after! - 1024;
  if (after === null) return before + 1024;
  return (before + after) / 2;
}
