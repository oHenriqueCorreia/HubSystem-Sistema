import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Attachment, ClientRow, Contract, Service } from "./types";

type Row = Record<string, unknown>;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

const CLIENT_COLUMNS = `id, lead_id, legal_name, document, billing_email, billing_phone_e164, owner_id, status, notes, converted_at,
  lead:leads(id, name, city, state, phone_e164, whatsapp_e164, email),
  contracts(id, amount_cents, recurrence, status, deleted_at)`;

function toClient(r: Row): ClientRow {
  return {
    ...(r as unknown as ClientRow),
    lead: one(r.lead as ClientRow["lead"])!,
    contracts: ((r.contracts as (ClientRow["contracts"][number] & { deleted_at: string | null })[]) ?? []).filter((c) => !c.deleted_at),
  };
}

export async function listClients(filters: { q?: string; status?: string; responsavel?: string }) {
  const supabase = await createClient();
  let q = supabase.from("clients").select(CLIENT_COLUMNS).is("deleted_at", null).order("converted_at", { ascending: false }).limit(500);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.responsavel) q = q.eq("owner_id", filters.responsavel);
  const { data, error } = await q;
  if (error) throw error;
  let rows = ((data ?? []) as Row[]).map(toClient);
  if (filters.q) {
    const t = filters.q.toLowerCase();
    rows = rows.filter((c) => c.lead?.name.toLowerCase().includes(t) || c.legal_name?.toLowerCase().includes(t) || c.document?.includes(t.replace(/\D/g, "") || "§"));
  }
  return rows;
}

export async function getClient(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("clients").select(CLIENT_COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  return data ? toClient(data as Row) : null;
}

export async function getClientByLead(leadId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("id").eq("lead_id", leadId).is("deleted_at", null).maybeSingle();
  return (data as { id: string } | null) ?? null;
}

const CONTRACT_COLUMNS = `id, client_id, service_id, deal_id, owner_id, title, description, amount_cents, payment_method, recurrence,
  start_date, end_date, due_day, status, notes, created_at,
  client:clients(id, legal_name, lead:leads(id, name)),
  service:services(id, name)`;

function toContract(r: Row): Contract {
  const client = one<Row>(r.client as Row | Row[] | null);
  return {
    ...(r as unknown as Contract),
    client: client ? { id: client.id as string, legal_name: client.legal_name as string | null, lead: one(client.lead as { id: string; name: string } | null) } : null,
    service: one(r.service as Contract["service"]),
  };
}

export async function listContracts(filters: { status?: string; servico?: string; cliente?: string; q?: string }) {
  const supabase = await createClient();
  let q = supabase.from("contracts").select(CONTRACT_COLUMNS).is("deleted_at", null).order("start_date", { ascending: false }).limit(1000);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.servico) q = q.eq("service_id", filters.servico);
  if (filters.cliente) q = q.eq("client_id", filters.cliente);
  if (filters.q) q = q.ilike("title", `%${filters.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as Row[]).map(toContract);
}

export async function getContract(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("contracts").select(CONTRACT_COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  return data ? toContract(data as Row) : null;
}

export async function listServices(): Promise<Service[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("services").select("id, name, kind, is_recurring, default_price_cents, is_active").order("name");
  if (error) throw error;
  return (data ?? []) as Service[];
}

export async function listAttachments(entityType: string, entityId: string): Promise<Attachment[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("attachments")
    .select("id, file_name, mime_type, size_bytes, created_at, uploaded_by, storage_path")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  return (data ?? []) as Attachment[];
}
