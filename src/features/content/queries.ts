import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ContentFormat, ContentStatus } from "@/domain/content";

const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** O nome legal é opcional: sem ele, vale o nome do lead que originou o cliente. */
function clientOption(raw: unknown): { id: string; legal_name: string } | null {
  const c = one(raw as { id: string; legal_name: string | null; lead?: unknown } | null);
  if (!c) return null;
  return { id: c.id, legal_name: c.legal_name || one(c.lead as { name?: string } | null)?.name || "Cliente" };
}

export type ContentAsset = { id: string; kind: "imagem" | "video_drive" | "video_arquivo"; file_name: string | null; drive_url: string | null; drive_file_id: string | null; drive_status: string | null; position: number; url: string | null };
export type ContentCard = { id: string; status: ContentStatus; caption: string; updated_at: string; task: { id: string; title: string; due_at: string | null; owner_id: string | null } | null; client: { id: string; legal_name: string } | null; board: string | null; list: string | null };

const CARD = "id, status, caption, updated_at, client:clients(id, legal_name, lead:leads(name)), task:tasks!inner(id, title, due_at, owner_id, deleted_at, list:task_columns(name, board:task_boards(name)))";

function toCard(r: Record<string, unknown>): ContentCard {
  const task = one<Record<string, unknown>>(r.task as Record<string, unknown> | null);
  const list = task ? one(task.list as { name: string; board: unknown } | null) : null;
  return {
    id: r.id as string,
    status: r.status as ContentStatus,
    caption: r.caption as string,
    updated_at: r.updated_at as string,
    client: clientOption(r.client),
    task: task ? { id: task.id as string, title: task.title as string, due_at: task.due_at as string | null, owner_id: task.owner_id as string | null } : null,
    board: list ? (one(list.board as { name: string } | null)?.name ?? null) : null,
    list: list?.name ?? null,
  };
}

export async function listContent(filter: { status?: string; client?: string }) {
  const supabase = await createClient();
  let q = supabase.from("content_items").select(CARD).is("task.deleted_at", null);
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.client) q = q.eq("client_id", filter.client);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(200);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(toCard);
}

export type SocialAccount = { id: string; platform: "facebook" | "instagram"; external_id: string; name: string; username: string | null; status: string; selected: boolean; last_error: string | null; picture_url: string | null; picture_checked_at: string | null };

export async function getSocialSetup() {
  const supabase = await createClient();
  const [accounts, connection] = await Promise.all([supabase.rpc("my_social_accounts"), supabase.rpc("my_social_connection")]);
  return {
    accounts: (accounts.data ?? []) as SocialAccount[],
    connection: (((connection.data ?? []) as { status: string; external_user: string; expires_at: string | null; last_error: string | null }[])[0] ?? null),
  };
}

export type ScheduleRow = { id: string; content_id: string; account_id: string; scheduled_at: string; status: string; permalink: string | null; error: string | null; published_at: string | null; account: { name: string; platform: string; username: string | null; picture_url: string | null } | null; title: string; caption: string; format: ContentFormat; thumb: string | null };

/** Calendário de conteúdo: publicações de um período. */
export async function listSchedules(fromIso: string, toIso: string) {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("content_schedules")
    .select("id, content_id, account_id, scheduled_at, status, permalink, error, published_at, content:content_items(caption, format, task:tasks(title), content_assets(kind, storage_path, position))")
    .gte("scheduled_at", fromIso)
    .lt("scheduled_at", toIso)
    .neq("status", "cancelado")
    .order("scheduled_at")
    .limit(500);
  if (error) throw error;
  const { accounts } = await getSocialSetup();
  type Raw = { caption: string; format: ContentFormat; task: unknown; content_assets: { kind: string; storage_path: string | null; position: number }[] };
  const list = (rows ?? []) as Record<string, unknown>[];
  const firstImage = (c: Raw | null) => c?.content_assets.filter((x) => x.kind === "imagem" && x.storage_path).sort((a, b) => a.position - b.position)[0]?.storage_path ?? null;
  const paths = [...new Set(list.map((r) => firstImage(one(r.content as Raw | null))).filter(Boolean))] as string[];
  // A RLS já confirmou o acesso: as miniaturas usam links temporários.
  const signed = paths.length ? await createAdminClient().storage.from("content-media").createSignedUrls(paths, 3600) : { data: [] };
  const thumbs = new Map((signed.data ?? []).map((x) => [x.path, x.signedUrl]));
  return list.map((r) => {
    const a = accounts.find((x) => x.id === r.account_id);
    const content = one(r.content as Raw | null);
    const task = content ? one(content.task as { title: string } | null) : null;
    const image = firstImage(content);
    return { ...(r as unknown as ScheduleRow), account: a ? { name: a.name, platform: a.platform, username: a.username, picture_url: a.picture_url } : null, title: task?.title ?? "Conteúdo", caption: content?.caption ?? "", format: content?.format ?? "post", thumb: image ? (thumbs.get(image) ?? null) : null };
  });
}

/** Links temporários das imagens. Só depois de a RLS confirmar que a pessoa enxerga o conteúdo. */
async function withUrls(assets: Omit<ContentAsset, "url">[], paths: Map<string, string>): Promise<ContentAsset[]> {
  const list = [...paths.values()];
  const signed = list.length ? await createAdminClient().storage.from("content-media").createSignedUrls(list, 3600) : { data: [] };
  const byPath = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
  return assets.map((a) => ({ ...a, url: paths.has(a.id) ? (byPath.get(paths.get(a.id)!) ?? null) : null }));
}

export async function getContent(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_items")
    .select("id, status, format, caption, version, approved_version, last_error, ad_campaign_id, updated_at, client:clients(id, legal_name, lead:leads(name)), campaign:ad_campaigns(id, name), task:tasks(id, title, due_at, has_time, owner_id, description, list:task_columns(name, board:task_boards(id, name)))")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [assets, reviews, schedules, setup] = await Promise.all([
    supabase.from("content_assets").select("id, kind, storage_path, file_name, drive_url, drive_file_id, drive_status, position").eq("content_id", id).order("position"),
    supabase.from("content_reviews").select("id, version, decision, comment, reviewer_name, created_at").eq("content_id", id).order("created_at", { ascending: false }),
    supabase.from("content_schedules").select("id, account_id, scheduled_at, status, permalink, error, published_at, version").eq("content_id", id).order("scheduled_at", { ascending: false }).limit(50),
    getSocialSetup(),
  ]);
  const rows = (assets.data ?? []) as (Omit<ContentAsset, "url"> & { storage_path: string | null })[];
  const paths = new Map(rows.filter((a) => a.storage_path).map((a) => [a.id, a.storage_path!]));
  const r = data as unknown as Record<string, unknown>;
  const task = one<Record<string, unknown>>(r.task as Record<string, unknown> | null);
  const list = task ? one(task.list as { name: string; board: unknown } | null) : null;
  return {
    id: r.id as string,
    status: r.status as ContentStatus,
    format: r.format as ContentFormat,
    caption: r.caption as string,
    version: r.version as number,
    approved_version: r.approved_version as number | null,
    last_error: r.last_error as string | null,
    client: clientOption(r.client),
    campaign: one(r.campaign as { id: string; name: string } | null),
    task: task as { id: string; title: string; due_at: string | null; has_time: boolean; owner_id: string | null; description: string | null } | null,
    board: list ? one(list.board as { id: string; name: string } | null) : null,
    list: list?.name ?? null,
    assets: await withUrls(rows, paths),
    reviews: (reviews.data ?? []) as { id: string; version: number; decision: "aprovado" | "ajustes"; comment: string | null; reviewer_name: string; created_at: string }[],
    schedules: (schedules.data ?? []) as { id: string; account_id: string; scheduled_at: string; status: string; permalink: string | null; error: string | null; published_at: string | null; version: number }[],
    accounts: setup.accounts,
  };
}

/** Página pública do cliente: tudo vem do hash do link, nunca da sessão. */
export async function getReviewByToken(tokenHash: string) {
  const admin = createAdminClient();
  const { data: link } = await admin.from("content_review_links").select("id, content_id, version, expires_at, revoked_at").eq("token_hash", tokenHash).maybeSingle();
  if (!link) return null;
  const { data: item } = await admin.from("content_items").select("id, caption, status, version, organization_id, task:tasks(title)").eq("id", link.content_id).single();
  if (!item) return null;
  const [assets, org, review] = await Promise.all([
    admin.from("content_assets").select("id, kind, storage_path, file_name, drive_url, drive_file_id, drive_status, position").eq("content_id", item.id).order("position"),
    admin.from("organizations").select("name").eq("id", item.organization_id).single(),
    admin.from("content_reviews").select("decision, reviewer_name, comment, created_at").eq("content_id", item.id).eq("version", link.version).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const rows = (assets.data ?? []) as (Omit<ContentAsset, "url"> & { storage_path: string | null })[];
  const paths = new Map(rows.filter((a) => a.storage_path).map((a) => [a.id, a.storage_path!]));
  const open = !link.revoked_at && new Date(link.expires_at).getTime() > Date.now() && item.version === link.version && item.status === "aguardando_aprovacao";
  return {
    open,
    expired: new Date(link.expires_at).getTime() <= Date.now(),
    outdated: item.version !== link.version,
    title: one(item.task as { title: string } | { title: string }[] | null)?.title ?? "Conteúdo",
    caption: item.caption as string,
    organization: (org.data?.name as string) ?? "",
    assets: await withUrls(rows, paths),
    review: review.data as { decision: "aprovado" | "ajustes"; reviewer_name: string; comment: string | null; created_at: string } | null,
  };
}
