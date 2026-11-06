import "server-only";
import { getCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import type { Attachment, ClientRow, Contract, Service } from "./types";

type Row = Record<string, unknown>;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

// Valores de contrato e dados de cobrança não são legíveis direto na tabela: vêm de
// contract_values e client_billing, que só respondem a quem tem a permissão.
const CLIENT_COLUMNS = `id, lead_id, legal_name, owner_id, status, notes, converted_at,
  lead:leads(id, name, city, state, phone_e164, whatsapp_e164, email),
  contracts(id, recurrence, status, deleted_at)`;

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Valor de cada contrato visível com contracts.values; ausente = sem permissão. */
async function contractAmounts(supabase: Supabase, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const { data, error } = await supabase.rpc("contract_values", { p_ids: ids });
  if (error) throw error;
  return new Map(((data ?? []) as { id: string; amount_cents: number }[]).map((r) => [r.id, Number(r.amount_cents)]));
}

async function withBilling(supabase: Supabase, rows: Row[], canBilling: boolean): Promise<ClientRow[]> {
  const contractIds = rows.flatMap((r) => ((r.contracts as { id: string }[] | null) ?? []).map((k) => k.id));
  const [amounts, billing] = await Promise.all([
    contractAmounts(supabase, contractIds),
    canBilling && rows.length ? supabase.rpc("client_billing", { p_ids: rows.map((r) => r.id as string) }) : Promise.resolve({ data: [], error: null }),
  ]);
  if (billing.error) throw billing.error;
  const byClient = new Map(((billing.data ?? []) as { id: string; document: string | null; billing_email: string | null; billing_phone_e164: string | null }[]).map((b) => [b.id, b]));
  return rows.map((r) => {
    const b = byClient.get(r.id as string);
    return {
      ...(r as unknown as ClientRow),
      document: b?.document ?? null,
      billing_email: b?.billing_email ?? null,
      billing_phone_e164: b?.billing_phone_e164 ?? null,
      billing_hidden: !canBilling,
      lead: one(r.lead as ClientRow["lead"])!,
      contracts: ((r.contracts as { id: string; recurrence: ClientRow["contracts"][number]["recurrence"]; status: ClientRow["contracts"][number]["status"]; deleted_at: string | null }[]) ?? [])
        .filter((c) => !c.deleted_at)
        .map((c) => ({ id: c.id, recurrence: c.recurrence, status: c.status, amount_cents: amounts.get(c.id) ?? null })),
    };
  });
}

async function canSeeBilling() {
  const user = await getCurrentUser();
  return Boolean(user?.permissions["clients.billing"]);
}

export async function listClients(filters: { q?: string; status?: string; responsavel?: string }) {
  const supabase = await createClient();
  let q = supabase.from("clients").select(CLIENT_COLUMNS).is("deleted_at", null).order("converted_at", { ascending: false }).limit(500);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.responsavel) q = q.eq("owner_id", filters.responsavel);
  const { data, error } = await q;
  if (error) throw error;
  let rows = await withBilling(supabase, (data ?? []) as Row[], await canSeeBilling());
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
  return data ? (await withBilling(supabase, [data as Row], await canSeeBilling()))[0] : null;
}

export async function getClientByLead(leadId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("id").eq("lead_id", leadId).is("deleted_at", null).maybeSingle();
  return (data as { id: string } | null) ?? null;
}

const CONTRACT_COLUMNS = `id, client_id, service_id, deal_id, owner_id, title, description, payment_method, recurrence,
  start_date, end_date, due_day, status, notes, created_at,
  client:clients(id, legal_name, lead:leads(id, name)),
  service:services(id, name)`;

function toContract(r: Row, amounts: Map<string, number>): Contract {
  const client = one<Row>(r.client as Row | Row[] | null);
  return {
    ...(r as unknown as Contract),
    amount_cents: amounts.get(r.id as string) ?? null,
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
  const rows = (data ?? []) as Row[];
  const amounts = await contractAmounts(supabase, rows.map((r) => r.id as string));
  return rows.map((r) => toContract(r, amounts));
}

export async function getContract(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("contracts").select(CONTRACT_COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  return data ? toContract(data as Row, await contractAmounts(supabase, [id])) : null;
}

export async function listServices(): Promise<Service[]> {
  const supabase = await createClient();
  const [list, prices] = await Promise.all([
    supabase.from("services").select("id, name, kind, is_recurring, is_active").order("name"),
    // Preço padrão só com contracts.values (a função devolve vazio sem a permissão).
    supabase.rpc("service_prices"),
  ]);
  if (list.error) throw list.error;
  if (prices.error) throw prices.error;
  const price = new Map(((prices.data ?? []) as { id: string; default_price_cents: number | null }[]).map((p) => [p.id, p.default_price_cents]));
  return ((list.data ?? []) as Omit<Service, "default_price_cents">[]).map((s) => ({ ...s, default_price_cents: price.get(s.id) ?? null }));
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
