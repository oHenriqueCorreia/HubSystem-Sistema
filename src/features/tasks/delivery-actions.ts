"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { driveFileId } from "@/domain/content";
import { baseMime, DELIVERY_MAX_BYTES, deliveryType, FEEDBACK_MAX_BYTES, FEEDBACK_MAX_IMAGES, feedbackType, isFeedbackPath } from "@/domain/deliveries";
import { fail, ok } from "@/domain/shared/result";
import { defineAction, must } from "@/lib/actions";
import { decrypt, encrypt } from "@/lib/crypto";
import { publicEnv } from "@/lib/env";
import { clientIp, RATE_LIMIT_MESSAGE, withinRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DELIVERY_COLUMNS, withDetails } from "./delivery-queries";
import { DELIVERIES_BUCKET, FEEDBACK_BUCKET, type Delivery } from "./delivery-types";

const LINK_DAYS = 90;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const linkUrl = (token: string) => `${publicEnv.NEXT_PUBLIC_SITE_URL}/aprovar/entrega/${token}`;
const FORBIDDEN = "Você não pode alterar as entregas desta tarefa.";

function refresh() {
  revalidatePath("/tarefas");
  revalidatePath("/inicio");
}

async function canManage(supabase: Awaited<ReturnType<typeof createClient>>, taskId: string) {
  const { data } = await supabase.rpc("can_manage_task_deliveries", { p_task: taskId });
  return Boolean(data);
}

/** Entrega que a pessoa enxerga e pode alterar. */
async function managed(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data } = await supabase.from("task_deliveries").select("id, task_id, organization_id, version, status").eq("id", id).maybeSingle();
  if (!data || !(await canManage(supabase, data.task_id as string))) return null;
  return data as { id: string; task_id: string; organization_id: string; version: number; status: string };
}

/** Só registra o que chegou mesmo ao armazenamento, dentro da pasta desta entrega. */
async function storedNames(bucket: string, prefix: string) {
  const { data } = await createAdminClient().storage.from(bucket).list(prefix, { limit: 1000 });
  return new Set((data ?? []).map((f) => f.name));
}

export const listDeliveries = defineAction({ schema: z.object({ taskId: z.uuid() }) }, async ({ taskId }) => {
  const supabase = await createClient();
  const rows = must(await supabase.from("task_deliveries").select(DELIVERY_COLUMNS).eq("task_id", taskId).order("created_at")) as Omit<Delivery, "files" | "reviews" | "maker_name">[];
  const manage = await canManage(supabase, taskId);
  let link: { url: string; expires_at: string } | null = null;
  if (manage) {
    const { data } = await createAdminClient().from("task_delivery_links").select("token_enc, expires_at").eq("task_id", taskId).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (data) link = { url: linkUrl(decrypt(data.token_enc as string)), expires_at: data.expires_at as string };
  }
  return ok({ deliveries: await withDetails(rows), canManage: manage, link });
});

const deliverySchema = z.object({
  id: z.uuid().optional(),
  taskId: z.uuid(),
  kind: z.string().trim().min(1, "Informe o tipo da entrega.").max(40),
  title: z.string().trim().min(1, "Dê um nome para a entrega.").max(160),
  notes: z.string().trim().max(4000).optional(),
  makerId: z.uuid().nullable().optional(),
  makerRole: z.string().trim().max(60).optional(),
});

export const saveDelivery = defineAction({ schema: deliverySchema }, async (input) => {
  const supabase = await createClient();
  if (!(await canManage(supabase, input.taskId))) return fail("forbidden", FORBIDDEN);
  const row = { kind: input.kind, title: input.title, notes: input.notes || null, maker_id: input.makerId ?? null, maker_role: input.makerRole || null };
  if (input.id) {
    must(await supabase.from("task_deliveries").update(row).eq("id", input.id).eq("task_id", input.taskId));
    refresh();
    return ok({ id: input.id }, "Entrega salva.");
  }
  const created = must(await supabase.from("task_deliveries").insert({ ...row, task_id: input.taskId }).select("id").single()) as { id: string };
  refresh();
  return ok({ id: created.id }, "Entrega criada.");
});

export const deleteDelivery = defineAction({ schema: z.object({ id: z.uuid() }) }, async ({ id }) => {
  const supabase = await createClient();
  const d = await managed(supabase, id);
  if (!d) return fail("forbidden", FORBIDDEN);
  const admin = createAdminClient();
  const { data: files } = await admin.from("task_delivery_files").select("storage_path").eq("delivery_id", id).not("storage_path", "is", null);
  const { data: reviews } = await admin.from("task_delivery_reviews").select("files:task_delivery_review_files(storage_path)").eq("delivery_id", id);
  const paths = (files ?? []).map((f) => f.storage_path as string);
  const feedback = ((reviews ?? []) as unknown as { files: { storage_path: string }[] }[]).flatMap((r) => r.files.map((f) => f.storage_path));
  if (paths.length) await admin.storage.from(DELIVERIES_BUCKET).remove(paths);
  if (feedback.length) await admin.storage.from(FEEDBACK_BUCKET).remove(feedback);
  must(await supabase.from("task_deliveries").delete().eq("id", id));
  refresh();
  return ok(null, "Entrega excluída.");
});

export const prepareDeliveryUpload = defineAction({ schema: z.object({ deliveryId: z.uuid(), mime: z.string().max(120), size: z.number().int().positive() }) }, async ({ deliveryId, mime, size }) => {
  const supabase = await createClient();
  const d = await managed(supabase, deliveryId);
  if (!d) return fail("forbidden", FORBIDDEN);
  const type = deliveryType(mime);
  if (!type) return fail("validation", "Envie imagem (JPG, PNG, WebP), vídeo (MP4, MOV, WebM) ou documento (PDF, Word, PowerPoint, Excel).");
  if (size > DELIVERY_MAX_BYTES) return fail("validation", "O arquivo passa de 50 MB. Para arquivos maiores, use o link do Google Drive.");
  const path = `${d.organization_id}/${d.task_id}/${d.id}/${crypto.randomUUID()}.${type.ext}`;
  const { data, error } = await createAdminClient().storage.from(DELIVERIES_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return fail("network", "Não foi possível preparar o envio do arquivo.");
  return ok({ path, token: data.token, mime: baseMime(mime) });
});

export const registerDeliveryFile = defineAction({ schema: z.object({ deliveryId: z.uuid(), path: z.string().max(300), name: z.string().trim().min(1).max(200), mime: z.string().max(120), size: z.number().int().positive() }) }, async ({ deliveryId, path, name, mime, size }) => {
  const supabase = await createClient();
  const d = await managed(supabase, deliveryId);
  if (!d) return fail("forbidden", FORBIDDEN);
  const prefix = `${d.organization_id}/${d.task_id}/${d.id}`;
  const type = deliveryType(mime);
  if (!type || !isFeedbackPath(path, prefix) || !(await storedNames(DELIVERIES_BUCKET, prefix)).has(path.slice(prefix.length + 1))) return fail("validation", "O arquivo não chegou ao servidor. Envie de novo.");
  must(await createAdminClient().from("task_delivery_files").insert({ organization_id: d.organization_id, delivery_id: d.id, version: d.version, kind: type.kind, storage_path: path, file_name: name, mime: baseMime(mime), size_bytes: size }));
  refresh();
  return ok(null);
});

export const addDeliveryDrive = defineAction({ schema: z.object({ deliveryId: z.uuid(), url: z.string().trim().max(500) }) }, async ({ deliveryId, url }) => {
  const supabase = await createClient();
  const d = await managed(supabase, deliveryId);
  if (!d) return fail("forbidden", FORBIDDEN);
  const fileId = driveFileId(url);
  if (!fileId) return fail("validation", "Cole o link de compartilhamento de um arquivo do Google Drive.");
  must(await createAdminClient().from("task_delivery_files").insert({ organization_id: d.organization_id, delivery_id: d.id, version: d.version, kind: "drive", drive_file_id: fileId, file_name: "Arquivo do Google Drive" }));
  refresh();
  return ok(null, "Link adicionado. Deixe o arquivo como “Qualquer pessoa com o link” no Drive.");
});

export const removeDeliveryFile = defineAction({ schema: z.object({ id: z.uuid() }) }, async ({ id }) => {
  const supabase = await createClient();
  const { data: file } = await supabase.from("task_delivery_files").select("id, delivery_id, storage_path").eq("id", id).maybeSingle();
  if (!file || !(await managed(supabase, file.delivery_id as string))) return fail("forbidden", FORBIDDEN);
  const admin = createAdminClient();
  if (file.storage_path) await admin.storage.from(DELIVERIES_BUCKET).remove([file.storage_path as string]);
  must(await admin.from("task_delivery_files").delete().eq("id", id));
  refresh();
  return ok(null, "Arquivo removido.");
});

export const newDeliveryVersion = defineAction({ schema: z.object({ id: z.uuid() }) }, async ({ id }) => {
  const supabase = await createClient();
  const version = must(await supabase.rpc("task_delivery_new_version", { p_delivery: id })) as number;
  refresh();
  return ok({ version });
});

/** O link é um só por tarefa: gerar de novo só troca o endereço quando pedido. */
export const generateDeliveryLink = defineAction({ schema: z.object({ taskId: z.uuid(), rotate: z.boolean().default(false) }) }, async ({ taskId, rotate }, { user }) => {
  const supabase = await createClient();
  if (!(await canManage(supabase, taskId))) return fail("forbidden", FORBIDDEN);
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: active } = await admin.from("task_delivery_links").select("id, token_enc, expires_at").eq("task_id", taskId).is("revoked_at", null).maybeSingle();
  if (active && !rotate && (active.expires_at as string) > now) return ok({ url: linkUrl(decrypt(active.token_enc as string)), expires_at: active.expires_at as string });
  if (active) must(await admin.from("task_delivery_links").update({ revoked_at: now }).eq("id", active.id));
  const token = randomBytes(32).toString("base64url");
  const expires_at = new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString();
  must(await admin.from("task_delivery_links").insert({ organization_id: user.organizationId, task_id: taskId, token_hash: hashToken(token), token_enc: encrypt(token), expires_at, created_by: user.id }));
  return ok({ url: linkUrl(token), expires_at }, "Link gerado.");
});

export const revokeDeliveryLink = defineAction({ schema: z.object({ taskId: z.uuid() }) }, async ({ taskId }) => {
  const supabase = await createClient();
  if (!(await canManage(supabase, taskId))) return fail("forbidden", FORBIDDEN);
  must(await createAdminClient().from("task_delivery_links").update({ revoked_at: new Date().toISOString() }).eq("task_id", taskId).is("revoked_at", null));
  return ok(null, "Link desativado. O cliente não consegue mais abrir.");
});

// --- Cliente, sem conta: o token é a única credencial ----------------------------------
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,100}$/);

/** Pasta dos anexos do cliente, se o link vale para esta entrega. */
async function feedbackPrefix(token: string, deliveryId: string) {
  const admin = createAdminClient();
  const { data: link } = await admin.from("task_delivery_links").select("task_id, organization_id, expires_at, revoked_at").eq("token_hash", hashToken(token)).maybeSingle();
  if (!link || link.revoked_at || (link.expires_at as string) <= new Date().toISOString()) return null;
  const { data: delivery } = await admin.from("task_deliveries").select("id").eq("id", deliveryId).eq("task_id", link.task_id).maybeSingle();
  return delivery ? `${link.organization_id}/${link.task_id}/${deliveryId}` : null;
}

export async function prepareFeedbackUpload(raw: { token: string; deliveryId: string; mime: string; size: number }) {
  const parsed = z.object({ token: tokenSchema, deliveryId: z.uuid(), mime: z.string().max(120), size: z.number().int().positive() }).safeParse(raw);
  if (!parsed.success) return fail("validation", "Confira o arquivo.");
  if (!(await withinRateLimit(`entrega-arquivo:${await clientIp()}`, 40, 600))) return fail("business_rule", RATE_LIMIT_MESSAGE);
  const type = feedbackType(parsed.data.mime);
  if (!type) return fail("validation", "Envie imagens em JPG, PNG ou WebP.");
  if (parsed.data.size > FEEDBACK_MAX_BYTES) return fail("validation", "O arquivo passa de 15 MB.");
  const prefix = await feedbackPrefix(parsed.data.token, parsed.data.deliveryId);
  if (!prefix) return fail("forbidden", "Este link não está mais ativo. Peça um novo à equipe.");
  const path = `${prefix}/${crypto.randomUUID()}.${type.ext}`;
  const { data, error } = await createAdminClient().storage.from(FEEDBACK_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return fail("network", "Não foi possível preparar o envio. Tente de novo.");
  return ok({ path, uploadToken: data.token, mime: baseMime(parsed.data.mime) });
}

const REVIEW_MESSAGES: Record<string, string> = {
  link_invalido: "Este link não está mais ativo. Peça um novo à equipe.",
  versao_antiga: "A equipe enviou uma versão nova. Veja a versão atual antes de decidir.",
  ja_aprovado: "Esta entrega já foi aprovada.",
  comentario_obrigatorio: "Conte o que precisa mudar: escreva, grave um áudio ou envie uma imagem.",
  decida_primeiro: "Aprove ou recuse a entrega primeiro.",
};

const reviewSchema = z.object({
  token: tokenSchema,
  deliveryId: z.uuid(),
  version: z.number().int().positive(),
  decision: z.enum(["aprovado", "recusado", "comentario"]),
  comment: z.string().trim().max(4000, "O comentário está muito longo."),
  name: z.string().trim().min(2, "Informe seu nome.").max(120),
  paths: z.array(z.string().max(300)).max(FEEDBACK_MAX_IMAGES + 1),
});

export async function submitDeliveryReview(raw: z.input<typeof reviewSchema>) {
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success) return fail("validation", parsed.error.issues[0]?.message ?? "Confira os dados.");
  const input = parsed.data;
  if (!(await withinRateLimit(`entrega:${await clientIp()}`, 30, 600))) return fail("business_rule", RATE_LIMIT_MESSAGE);
  const prefix = await feedbackPrefix(input.token, input.deliveryId);
  if (!prefix) return fail("forbidden", REVIEW_MESSAGES.link_invalido);
  let files: { kind: "audio" | "imagem"; path: string }[] = [];
  if (input.paths.length) {
    const stored = await storedNames(FEEDBACK_BUCKET, prefix);
    if (input.paths.some((p) => !isFeedbackPath(p, prefix) || !stored.has(p.slice(prefix.length + 1)))) return fail("validation", "Um dos anexos não chegou. Envie de novo.");
    files = input.paths.map((path) => ({ kind: /\.(jpg|png|webp)$/.test(path) ? ("imagem" as const) : ("audio" as const), path }));
    if (files.filter((f) => f.kind === "audio").length > 1) return fail("validation", "Envie um áudio por comentário.");
  }
  const { data, error } = await createAdminClient().rpc("task_delivery_decide", { p_token_hash: hashToken(input.token), p_delivery: input.deliveryId, p_version: input.version, p_decision: input.decision, p_comment: input.comment, p_name: input.name, p_files: files });
  if (error) return fail("unknown", "Não foi possível registrar agora. Tente de novo.");
  if (data !== "ok") return fail("business_rule", REVIEW_MESSAGES[data as string] ?? "Não foi possível registrar.");
  refresh();
  return ok(null, input.decision === "aprovado" ? "Aprovação registrada. Obrigado!" : input.decision === "recusado" ? "Recusa enviada. A equipe já foi avisada." : "Comentário enviado à equipe.");
}
