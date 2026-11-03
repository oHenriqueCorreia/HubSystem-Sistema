import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto";
import { driveDownloadUrl, formatProblem, isAuthError, metaErrorMessage, publishProblem, type ContentFormat, type SchedulePlatform } from "@/domain/content";
import { instagramContainer, instagramContainerStatus, instagramPublish, instagramWithinLimit, publishFacebook, type GraphFailure, type MediaPlan } from "@/lib/meta-social";

const SIGNED_SECONDS = 3600;

type Due = { id: string; organization_id: string; content_id: string; account_id: string; container_id: string | null; attempts: number };

async function mediaFor(contentId: string) {
  const admin = createAdminClient();
  const [{ data: item }, { data: assets }] = await Promise.all([
    admin.from("content_items").select("caption, format").eq("id", contentId).single(),
    admin.from("content_assets").select("kind, storage_path, drive_file_id").eq("content_id", contentId).order("position"),
  ]);
  const imagePaths = (assets ?? []).filter((a) => a.kind === "imagem").map((a) => a.storage_path as string);
  const video = (assets ?? []).find((a) => a.kind !== "imagem");
  const signedVideo = video?.kind === "video_arquivo" ? await admin.storage.from("content-media").createSignedUrl(video.storage_path as string, SIGNED_SECONDS) : null;
  // A Meta baixa a mídia de um link: o link assinado vale só durante a publicação.
  const signed = imagePaths.length ? await admin.storage.from("content-media").createSignedUrls(imagePaths, SIGNED_SECONDS) : { data: [] };
  const imageUrls = (signed.data ?? []).map((s) => s.signedUrl).filter(Boolean) as string[];
  const videoUrl = video ? (video.kind === "video_arquivo" ? (signedVideo?.data?.signedUrl ?? null) : driveDownloadUrl(video.drive_file_id as string)) : null;
  const plan: MediaPlan = { caption: (item?.caption as string) ?? "", imageUrls, videoUrl, format: ((item?.format as MediaPlan["format"]) ?? "post") };
  return { plan, counts: { images: imagePaths.length, videos: (assets ?? []).filter((a) => a.kind !== "imagem").length, caption: plan.caption } };
}

async function expireAccount(organizationId: string, accountId: string, message: string) {
  const admin = createAdminClient();
  await admin.from("social_accounts").update({ status: "expirada", last_error: message, updated_at: new Date().toISOString() }).eq("id", accountId);
  await admin.from("integration_connections").update({ status: "expirada", last_error: message, updated_at: new Date().toISOString() }).eq("organization_id", organizationId).eq("provider", "meta_social");
}

async function publishOne(s: Due) {
  const admin = createAdminClient();
  const finish = (status: "publicado" | "erro" | "publicando", externalId: string | null, permalink: string | null, error: string | null, container: string | null = null) =>
    admin.rpc("content_finish", { p_schedule: s.id, p_status: status, p_external: externalId, p_permalink: permalink, p_error: error, p_container: container });

  const { data: account } = await admin.from("social_accounts").select("platform, external_id, page_id, token_enc, status").eq("id", s.account_id).single();
  if (!account || account.status !== "ativa") return finish("erro", null, null, "A conta de destino está desconectada. Reconecte e agende de novo.");
  const platform = account.platform as SchedulePlatform;
  const token = decrypt(account.token_enc);

  try {
    const { plan, counts } = await mediaFor(s.content_id);
    const problem = (plan.format === "stories" ? formatProblem(plan.format as ContentFormat, counts) : null) ?? publishProblem(platform, counts);
    if (problem) return finish("erro", null, null, problem);

    if (platform === "facebook") {
      const r = await publishFacebook(account.page_id, token, plan);
      if (r.done) return finish("publicado", r.externalId, r.permalink, null);
      return;
    }

    // Instagram: cria o contêiner, espera o processamento e publica. Vídeo pode levar mais de uma rodada.
    let container = s.container_id;
    if (!container) {
      if (!(await instagramWithinLimit(account.external_id, token))) return finish("erro", null, null, "A conta atingiu o limite de publicações do Instagram nas últimas 24 horas.");
      container = await instagramContainer(account.external_id, token, plan);
    }
    const state = await instagramContainerStatus(container, token);
    const code = state.status_code;
    if (code === "ERROR" || code === "EXPIRED") return finish("erro", null, null, `O Instagram não processou a mídia${state.status ? `: ${state.status}` : "."} Se for vídeo do Drive, confira se o link está público.`.slice(0, 480));
    if (code === "IN_PROGRESS") {
      if (s.attempts >= 7) return finish("erro", null, null, "O Instagram demorou demais para processar o vídeo. Agende de novo.");
      return finish("publicando", null, null, null, container);
    }
    const r = await instagramPublish(account.external_id, token, container);
    if (r.done) return finish("publicado", r.externalId, r.permalink, null);
  } catch (e) {
    const err = e as GraphFailure;
    const message = metaErrorMessage(err.code, err.detail);
    if (isAuthError(err.code)) await expireAccount(s.organization_id, s.account_id, message);
    return finish("erro", null, null, message);
  }
}

/** Publica o que venceu. Cada publicação é isolada: uma falha não impede as outras. */
export async function runContentPublisher() {
  const admin = createAdminClient();
  const { data } = await admin.rpc("content_claim_due", { p_limit: 10 });
  for (const s of (data ?? []) as Due[]) {
    try {
      await publishOne(s);
    } catch {
      console.error("[conteudo] falha ao publicar");
      await admin.rpc("content_finish", { p_schedule: s.id, p_status: "erro", p_external: null, p_permalink: null, p_error: "Falha inesperada ao publicar. Agende de novo." });
    }
  }
}
