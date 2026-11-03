export type MediaKind = "image" | "video" | "audio" | "document";

const MB = 1024 * 1024;

const RULES: { test: RegExp; kind: MediaKind; maxBytes: number }[] = [
  { test: /^image\/(jpeg|png)$/, kind: "image", maxBytes: 5 * MB },
  { test: /^video\/(mp4|3gpp)$/, kind: "video", maxBytes: 16 * MB },
  { test: /^audio\/(ogg|mpeg|mp4|aac|amr|webm)$/, kind: "audio", maxBytes: 16 * MB },
  { test: /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.[\w.]+|text\/plain)$/, kind: "document", maxBytes: 50 * MB },
];

/** O navegador grava "audio/webm;codecs=opus": só o tipo interessa para a regra. */
export const baseMime = (mime: string) => mime.split(";")[0].trim().toLowerCase();

/** O que o seletor de arquivos oferece no envio. */
export const MEDIA_ACCEPT = "image/jpeg,image/png,video/mp4,audio/ogg,audio/mpeg,audio/mp4,audio/aac,.pdf,.doc,.docx,.xlsx,.pptx,.txt";

/** Valida o arquivo antes de enviar. A API oficial não aceita áudio webm; o QR Code converte. */
export function checkOutgoingMedia(input: { mime: string; size: number; provider: "cloud" | "waha" }): { ok: true; kind: MediaKind } | { ok: false; message: string } {
  const mime = baseMime(input.mime);
  const rule = RULES.find((r) => r.test.test(mime));
  if (!rule) return { ok: false, message: "Este tipo de arquivo não pode ser enviado pelo WhatsApp. Use imagem JPG ou PNG, vídeo MP4, áudio ou documento." };
  if (input.size <= 0) return { ok: false, message: "O arquivo está vazio." };
  if (input.size > rule.maxBytes) return { ok: false, message: `O arquivo passa do limite de ${rule.maxBytes / MB} MB para este tipo.` };
  if (mime === "audio/webm" && input.provider === "cloud") return { ok: false, message: "A API oficial não aceita o áudio gravado neste navegador. Envie um arquivo de áudio MP3 ou OGG." };
  return { ok: true, kind: rule.kind };
}

/** Caminho de um arquivo enviado: separado por organização, sem nome vindo do usuário. */
export const outgoingPath = (organizationId: string, id: string) => `${organizationId}/enviados/${id}`;

export const isOutgoingPath = (path: string, organizationId: string) => new RegExp(`^${organizationId}/enviados/[0-9a-f-]{36}$`, "i").test(path);
