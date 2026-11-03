export type ContentStatus = "em_producao" | "aguardando_aprovacao" | "ajustes_solicitados" | "aprovado" | "agendado" | "publicado" | "erro";
export type SchedulePlatform = "facebook" | "instagram";
export const CONTENT_FORMATS = ["post", "video", "reels", "stories"] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export const FORMAT_LABEL: Record<ContentFormat, string> = { post: "Post", video: "Vídeo", reels: "Reels", stories: "Stories" };

/** Limites de duração do vídeo de stories na Meta. */
export const STORY_MIN_SECONDS = 3;
export const STORY_MAX_SECONDS = 60;

export function storyVideoProblem(seconds: number): string | null {
  if (!Number.isFinite(seconds)) return null;
  if (seconds > STORY_MAX_SECONDS) return `Stories aceitam vídeo de até ${STORY_MAX_SECONDS} segundos. Este tem ${Math.round(seconds)}.`;
  if (seconds < STORY_MIN_SECONDS) return `Stories pedem vídeo de pelo menos ${STORY_MIN_SECONDS} segundos.`;
  return null;
}

/** O que cada formato pede, antes de olhar a plataforma. */
export function formatProblem(format: ContentFormat, m: PublishMedia): string | null {
  if (format === "stories") return m.images + m.videos === 1 ? null : "Stories leva uma imagem ou um vídeo, um de cada vez.";
  if (format === "post") return m.videos > 0 ? "Post leva imagens. Para vídeo, crie um Vídeo ou Reels." : null;
  if (m.images > 0) return `${FORMAT_LABEL[format]} leva só o vídeo: remova as imagens.`;
  if (m.videos !== 1) return `${FORMAT_LABEL[format]} precisa de um vídeo.`;
  return null;
}

/** Limites de arquivo do armazenamento. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const VIDEO_TYPES = ["video/mp4", "video/quicktime"];

export const CONTENT_STATUS_LABEL: Record<ContentStatus, string> = {
  em_producao: "Em produção",
  aguardando_aprovacao: "Aguardando aprovação",
  ajustes_solicitados: "Ajustes solicitados",
  aprovado: "Aprovado",
  agendado: "Agendado",
  publicado: "Publicado",
  erro: "Erro",
};

export const SCHEDULE_STATUS_LABEL: Record<string, string> = { agendado: "Agendado", publicando: "Publicando", publicado: "Publicado", erro: "Erro", cancelado: "Cancelado" };

export const PLATFORM_LABEL: Record<SchedulePlatform, string> = { facebook: "Facebook", instagram: "Instagram" };

/** Id do arquivo em links do Google Drive. Pastas e outros endereços não servem. */
export function driveFileId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !["drive.google.com", "docs.google.com", "drive.usercontent.google.com"].includes(url.hostname)) return null;
  const inPath = /\/(?:file\/)?d\/([A-Za-z0-9_-]{10,})/.exec(url.pathname)?.[1];
  const id = inPath ?? url.searchParams.get("id");
  return id && /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : null;
}

export const drivePreviewUrl = (id: string) => `https://drive.google.com/file/d/${id}/preview`;
export const driveDownloadUrl = (id: string) => `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;

export type PublishMedia = { images: number; videos: number; caption: string };

export const IG_CAPTION_MAX = 2200;
export const IG_HASHTAG_MAX = 30;
export const IG_CAROUSEL_MAX = 10;
export const FB_PHOTOS_MAX = 10;

/** Formatos e limites das plataformas, conferidos antes de agendar e antes de publicar. */
export function publishProblem(platform: SchedulePlatform, m: PublishMedia): string | null {
  if (m.images > 0 && m.videos > 0) return "Publique fotos ou vídeo, não os dois juntos.";
  if (m.videos > 1) return "Só é possível publicar um vídeo por vez.";
  if (platform === "instagram") {
    if (m.images === 0 && m.videos === 0) return "O Instagram exige uma imagem ou um vídeo.";
    if (m.images > IG_CAROUSEL_MAX) return `O carrossel do Instagram aceita até ${IG_CAROUSEL_MAX} imagens aqui.`;
    if (m.caption.length > IG_CAPTION_MAX) return `A legenda do Instagram aceita até ${IG_CAPTION_MAX} caracteres.`;
    if ((m.caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > IG_HASHTAG_MAX) return `O Instagram aceita até ${IG_HASHTAG_MAX} hashtags.`;
    return null;
  }
  if (m.images === 0 && m.videos === 0 && !m.caption.trim()) return "Escreva a legenda ou adicione uma mídia.";
  if (m.images > FB_PHOTOS_MAX) return `Publique até ${FB_PHOTOS_MAX} fotos por vez no Facebook.`;
  return null;
}

/** Erro da Graph API em linguagem clara. */
export function metaErrorMessage(code: number | undefined, detail: string | undefined) {
  if (code === 190) return "O acesso à conta Meta expirou. Reconecte a conta para publicar.";
  if (code === 10 || code === 200) return "A conta conectada não tem permissão para publicar aqui. Reconecte e aceite as permissões.";
  if (code === 4 || code === 17 || code === 32 || code === 613) return "A Meta limitou as chamadas agora. Tente novamente mais tarde.";
  if (code === 9 || code === 368) return "A Meta bloqueou temporariamente esta publicação ou atingiu o limite de publicações do dia.";
  return detail ? `A Meta recusou a publicação: ${detail}`.slice(0, 480) : "A Meta recusou a publicação.";
}

export const isAuthError = (code: number | undefined) => code === 190;
