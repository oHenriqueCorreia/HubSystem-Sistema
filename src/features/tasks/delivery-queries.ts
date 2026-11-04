import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { DELIVERIES_BUCKET, FEEDBACK_BUCKET, type Delivery, type DeliveryFile, type DeliveryReview } from "./delivery-types";

const URL_SECONDS = 2 * 60 * 60;

async function signed(bucket: string, paths: string[]) {
  if (!paths.length) return new Map<string, string>();
  const { data } = await createAdminClient().storage.from(bucket).createSignedUrls(paths, URL_SECONDS);
  return new Map((data ?? []).flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as const] : [])));
}

type DeliveryRow = Omit<Delivery, "files" | "reviews" | "maker_name">;

/** Junta arquivos da versão atual e comentários, com links temporários do armazenamento privado. */
export async function withDetails(rows: DeliveryRow[]): Promise<Delivery[]> {
  if (!rows.length) return [];
  const admin = createAdminClient();
  const ids = rows.map((d) => d.id);
  const [files, reviews, makers] = await Promise.all([
    admin.from("task_delivery_files").select("id, delivery_id, version, kind, storage_path, drive_file_id, file_name, mime, size_bytes").in("delivery_id", ids).order("created_at"),
    admin.from("task_delivery_reviews").select("id, delivery_id, version, decision, comment, reviewer_name, created_at, files:task_delivery_review_files(id, kind, storage_path)").in("delivery_id", ids).order("created_at", { ascending: false }),
    admin.from("profiles").select("id, full_name, email").in("id", rows.flatMap((d) => (d.maker_id ? [d.maker_id] : []))),
  ]);
  const versions = new Map(rows.map((d) => [d.id, d.version]));
  const current = ((files.data ?? []) as (Omit<DeliveryFile, "url"> & { delivery_id: string; version: number })[]).filter((f) => versions.get(f.delivery_id) === f.version);
  const reviewRows = (reviews.data ?? []) as unknown as (Omit<DeliveryReview, "files"> & { delivery_id: string; files: { id: string; kind: "audio" | "imagem"; storage_path: string }[] })[];
  const [fileUrls, feedbackUrls] = await Promise.all([
    signed(DELIVERIES_BUCKET, current.flatMap((f) => (f.storage_path ? [f.storage_path] : []))),
    signed(FEEDBACK_BUCKET, reviewRows.flatMap((r) => r.files.map((f) => f.storage_path))),
  ]);
  const names = new Map(((makers.data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((p) => [p.id, p.full_name || p.email || null]));
  return rows.map((d) => ({
    ...d,
    maker_name: d.maker_id ? (names.get(d.maker_id) ?? null) : null,
    files: current.filter((f) => f.delivery_id === d.id).map((f) => ({ ...f, url: f.storage_path ? (fileUrls.get(f.storage_path) ?? null) : null })),
    reviews: reviewRows.filter((r) => r.delivery_id === d.id).map((r) => ({ ...r, files: r.files.map((f) => ({ id: f.id, kind: f.kind, url: feedbackUrls.get(f.storage_path) ?? null })) })),
  }));
}

export const DELIVERY_COLUMNS = "id, task_id, kind, title, notes, maker_id, maker_role, status, version, created_at";

/** O que o cliente vê. Quem chega aqui já apresentou o token: tudo passa pelo servidor. */
export async function getDeliveryPortal(tokenHash: string) {
  const admin = createAdminClient();
  const { data: link } = await admin.from("task_delivery_links").select("task_id, organization_id, expires_at, revoked_at").eq("token_hash", tokenHash).maybeSingle();
  if (!link) return null;
  if (link.revoked_at || new Date(link.expires_at as string).getTime() <= Date.now()) return { open: false as const };
  const [task, org, rows] = await Promise.all([
    admin.from("tasks").select("title, deleted_at, client:clients(legal_name, lead:leads(name))").eq("id", link.task_id).maybeSingle(),
    admin.from("organizations").select("name").eq("id", link.organization_id).maybeSingle(),
    admin.from("task_deliveries").select(DELIVERY_COLUMNS).eq("task_id", link.task_id).order("created_at"),
  ]);
  if (!task.data || task.data.deleted_at) return { open: false as const };
  const rawClient = (Array.isArray(task.data.client) ? task.data.client[0] : task.data.client) as { legal_name: string | null; lead: unknown } | null;
  const lead = (Array.isArray(rawClient?.lead) ? rawClient?.lead[0] : rawClient?.lead) as { name?: string } | null | undefined;
  return {
    open: true as const,
    title: task.data.title as string,
    client: rawClient?.legal_name || lead?.name || null,
    organization: (org.data?.name as string) ?? "",
    deliveries: await withDetails((rows.data ?? []) as DeliveryRow[]),
  };
}
