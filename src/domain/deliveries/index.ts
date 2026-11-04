export type DeliveryStatus = "aguardando" | "aprovado" | "recusado";
export type DeliveryFileKind = "imagem" | "video" | "documento" | "drive";

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  aguardando: "Aguardando o cliente",
  aprovado: "Aprovado",
  recusado: "Recusado",
};

/** Sugestões: os dois campos aceitam qualquer texto, para cada empresa usar os seus nomes. */
export const DELIVERY_KINDS = ["Post", "Carrossel", "Stories", "Reels", "Vídeo", "Arte", "Anúncio", "Documento", "Apresentação"];
export const MAKER_ROLES = ["Designer gráfico", "Gestor de tráfego", "Social media", "Editor de vídeo", "Copywriter", "Atendimento"];

export const DELIVERY_MAX_BYTES = 50 * 1024 * 1024;
export const FEEDBACK_MAX_BYTES = 15 * 1024 * 1024;
export const FEEDBACK_MAX_IMAGES = 5;

const DELIVERY_TYPES: Record<string, { kind: Exclude<DeliveryFileKind, "drive">; ext: string }> = {
  "image/jpeg": { kind: "imagem", ext: "jpg" },
  "image/png": { kind: "imagem", ext: "png" },
  "image/webp": { kind: "imagem", ext: "webp" },
  "video/mp4": { kind: "video", ext: "mp4" },
  "video/quicktime": { kind: "video", ext: "mov" },
  "video/webm": { kind: "video", ext: "webm" },
  "application/pdf": { kind: "documento", ext: "pdf" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { kind: "documento", ext: "docx" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { kind: "documento", ext: "pptx" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { kind: "documento", ext: "xlsx" },
};

const FEEDBACK_TYPES: Record<string, { kind: "audio" | "imagem"; ext: string }> = {
  "image/jpeg": { kind: "imagem", ext: "jpg" },
  "image/png": { kind: "imagem", ext: "png" },
  "image/webp": { kind: "imagem", ext: "webp" },
  "audio/webm": { kind: "audio", ext: "webm" },
  "audio/ogg": { kind: "audio", ext: "ogg" },
  "audio/mp4": { kind: "audio", ext: "m4a" },
  "audio/mpeg": { kind: "audio", ext: "mp3" },
  "audio/aac": { kind: "audio", ext: "aac" },
};

export const DELIVERY_ACCEPT = Object.keys(DELIVERY_TYPES).join(",");
export const FEEDBACK_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

/** O navegador grava "audio/webm;codecs=opus"; o armazenamento só conhece a parte antes do ponto e vírgula. */
export const baseMime = (mime: string) => mime.split(";")[0].trim().toLowerCase();

export const deliveryType = (mime: string) => DELIVERY_TYPES[baseMime(mime)] ?? null;
export const feedbackType = (mime: string) => FEEDBACK_TYPES[baseMime(mime)] ?? null;

/** Situação mais urgente primeiro: é a que a equipe precisa ver na lista e no quadro. */
export function deliverySummary(items: { status: DeliveryStatus }[]): { status: DeliveryStatus; label: string } | null {
  if (!items.length) return null;
  const count = (s: DeliveryStatus) => items.filter((i) => i.status === s).length;
  const plural = items.length > 1;
  if (count("recusado")) return { status: "recusado", label: plural ? `${count("recusado")} de ${items.length} recusadas` : "Recusado" };
  if (count("aguardando")) return { status: "aguardando", label: plural ? `${count("aguardando")} de ${items.length} aguardando` : "Aguardando o cliente" };
  return { status: "aprovado", label: plural ? `${items.length} aprovadas` : "Aprovado" };
}

/** O caminho vem do navegador do cliente: só vale o que o servidor gerou para esta entrega. */
export function isFeedbackPath(path: string, prefix: string) {
  if (!path.startsWith(`${prefix}/`)) return false;
  return /^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/.test(path.slice(prefix.length + 1));
}
