"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto";
import { publicEnv } from "@/lib/env";
import { clientIp, withinRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { socialRevoke } from "@/lib/meta-social";
import { zonedIso } from "@/domain/calendar";
import { fail, ok } from "@/domain/shared/result";
import { driveFileId, publishProblem, type SchedulePlatform } from "@/domain/content";

const LINK_DAYS = 14;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function refresh(id?: string) {
  revalidatePath("/conteudo");
  if (id) revalidatePath(`/conteudo/${id}`);
  revalidatePath("/tarefas");
  revalidatePath("/agenda");
  revalidatePath("/inicio");
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const createContentTask = defineAction(
  {
    schema: z.object({
      title: z.string().trim().min(1, "Informe o título.").max(200),
      description: z.string().trim().max(10000).default(""),
      clientId: z.uuid("Escolha o cliente."),
      columnId: z.uuid("Escolha a lista."),
      ownerId: z.uuid().nullable().default(null),
      campaignId: z.uuid().nullable().default(null),
      dueDate: z.iso.date().nullable().default(null),
      dueTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
    }),
    permission: "content.manage",
  },
  async (input, { user }) => {
    if (!user.permissions["tasks.create"]) return fail("forbidden", "Você não tem permissão para criar tarefas.");
    const supabase = await createClient();
    const id = must(
      await supabase.rpc("create_content_task", {
        p_title: input.title,
        p_description: input.description,
        p_column: input.columnId,
        p_owner: input.ownerId,
        p_client: input.clientId,
        p_campaign: input.campaignId,
        p_due: input.dueDate ? zonedIso(input.dueDate, input.dueTime ?? "23:59") : null,
        p_has_time: Boolean(input.dueDate && input.dueTime),
      }),
    ) as string;
    refresh();
    return ok({ id }, "Tarefa de produção criada.");
  },
);

export const saveCaption = defineAction({ schema: z.object({ id: z.uuid(), caption: z.string().max(2200, "A legenda aceita até 2.200 caracteres.") }), permission: "content.manage" }, async ({ id, caption }) => {
  const supabase = await createClient();
  const res = must(await supabase.from("content_items").update({ caption }).eq("id", id).select("status")) as { status: string }[];
  if (!res.length) return fail("forbidden", "Você não pode alterar este conteúdo.");
  refresh(id);
  return ok(null, "Legenda salva.");
});

export const setContentCampaign = defineAction({ schema: z.object({ id: z.uuid(), campaignId: z.uuid().nullable() }), permission: "content.manage" }, async ({ id, campaignId }) => {
  const supabase = await createClient();
  must(await supabase.from("content_items").update({ ad_campaign_id: campaignId }).eq("id", id));
  refresh(id);
  return ok(null, "Campanha salva.");
});

/** Reserva o envio direto do navegador. As imagens já chegam convertidas para JPEG, o único formato que o Instagram aceita. */
export const prepareImageUpload = defineAction({ schema: z.object({ contentId: z.uuid(), size: z.number().int().positive() }), permission: "content.manage" }, async ({ contentId, size }, { user }) => {
  if (size > MAX_IMAGE_BYTES) return fail("validation", "A imagem passa de 8 MB. Use um arquivo menor.");
  const supabase = await createClient();
  const { data: item } = await supabase.from("content_items").select("id").eq("id", contentId).maybeSingle();
  if (!item) return fail("not_found", "Conteúdo não encontrado.");
  const path = `${user.organizationId}/${contentId}/${crypto.randomUUID()}.jpg`;
  const { data, error } = await createAdminClient().storage.from("content-media").createSignedUploadUrl(path);
  if (error || !data) return fail("network", "Não foi possível preparar o envio da imagem.");
  return ok({ path, token: data.token });
});

export const registerImage = defineAction(
  { schema: z.object({ contentId: z.uuid(), path: z.string().max(200), fileName: z.string().trim().min(1).max(200), size: z.number().int().positive() }), permission: "content.manage" },
  async (input, { user }) => {
    if (!input.path.startsWith(`${user.organizationId}/${input.contentId}/`)) return fail("forbidden", "Arquivo inválido.");
    const supabase = await createClient();
    must(await supabase.from("content_assets").insert({ content_id: input.contentId, kind: "imagem", storage_path: input.path, file_name: input.fileName, mime_type: "image/jpeg", size_bytes: input.size, position: Date.now() / 1000 }));
    refresh(input.contentId);
    return ok(null, "Imagem anexada.");
  },
);

/** Sem login: acessível para quem revisa = abre sem pedir conta do Google. */
async function driveReachable(id: string): Promise<"ok" | "inacessivel" | "nao_verificado"> {
  try {
    const res = await fetch(`https://drive.google.com/file/d/${id}/view`, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (res.status === 200) return "ok";
    if (res.status === 404 || res.status === 403) return "inacessivel";
    const location = res.headers.get("location") ?? "";
    if (res.status >= 300 && res.status < 400) return location.includes("accounts.google.com") ? "inacessivel" : "ok";
    return "nao_verificado";
  } catch {
    return "nao_verificado";
  }
}

export const addDriveVideo = defineAction({ schema: z.object({ contentId: z.uuid(), url: z.string().trim().min(10, "Cole o link do vídeo.").max(500) }), permission: "content.manage" }, async ({ contentId, url }) => {
  const id = driveFileId(url);
  if (!id) return fail("validation", "Use o link de um arquivo do Google Drive, não de uma pasta.");
  const status = await driveReachable(id);
  const supabase = await createClient();
  must(await supabase.from("content_assets").insert({ content_id: contentId, kind: "video_drive", drive_url: url, drive_file_id: id, drive_status: status, position: Date.now() / 1000 }));
  refresh(contentId);
  if (status === "inacessivel") return ok({ status: status as string }, "Vídeo adicionado, mas o link não está acessível. No Drive, escolha Qualquer pessoa com o link.");
  if (status === "nao_verificado") return ok({ status: status as string }, "Vídeo adicionado. Não foi possível conferir o acesso agora: confira se o link está aberto.");
  return ok({ status: status as string }, "Vídeo adicionado.");
});

export const recheckDriveVideo = defineAction({ schema: z.object({ id: z.uuid(), contentId: z.uuid() }), permission: "content.manage" }, async ({ id, contentId }) => {
  const supabase = await createClient();
  const asset = must(await supabase.from("content_assets").select("drive_file_id").eq("id", id).single()) as { drive_file_id: string };
  const status = await driveReachable(asset.drive_file_id);
  must(await supabase.from("content_assets").update({ drive_status: status }).eq("id", id));
  refresh(contentId);
  return ok(null, status === "ok" ? "Link acessível." : status === "inacessivel" ? "O link continua fechado. No Drive, escolha Qualquer pessoa com o link." : "Não foi possível conferir agora.");
});

export const removeAsset = defineAction({ schema: z.object({ id: z.uuid(), contentId: z.uuid() }), permission: "content.manage" }, async ({ id, contentId }) => {
  const supabase = await createClient();
  const rows = must(await supabase.from("content_assets").delete().eq("id", id).select("storage_path")) as { storage_path: string | null }[];
  if (rows[0]?.storage_path) await createAdminClient().storage.from("content-media").remove([rows[0].storage_path]);
  refresh(contentId);
  return ok(null, "Mídia removida.");
});

/** Gera o link do cliente. O token só existe na resposta: no banco fica o hash. */
export const requestApproval = defineAction({ schema: z.object({ id: z.uuid() }), permission: "content.manage" }, async ({ id }) => {
  const supabase = await createClient();
  const token = randomBytes(32).toString("base64url");
  must(await supabase.rpc("content_submit_for_approval", { p_content: id, p_token_hash: hashToken(token), p_expires: new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString() }));
  refresh(id);
  return ok({ url: `${publicEnv.NEXT_PUBLIC_SITE_URL}/aprovar/${token}` }, "Link de aprovação gerado.");
});

export const scheduleContent = defineAction(
  { schema: z.object({ id: z.uuid(), accountIds: z.array(z.uuid()).min(1, "Escolha ao menos uma conta."), date: z.iso.date({ error: "Informe a data." }), time: z.string().regex(/^\d{2}:\d{2}$/, "Informe o horário.") }), permission: "content.publish" },
  async (input) => {
    const supabase = await createClient();
    const [{ data: assets }, { data: item }, { data: accounts }] = await Promise.all([
      supabase.from("content_assets").select("kind, drive_status").eq("content_id", input.id),
      supabase.from("content_items").select("caption").eq("id", input.id).single(),
      supabase.rpc("my_social_accounts"),
    ]);
    const list = (assets ?? []) as { kind: string; drive_status: string | null }[];
    if (list.some((a) => a.drive_status === "inacessivel")) return fail("business_rule", "O link do vídeo não está acessível. Abra o acesso no Drive e confira de novo.");
    const counts = { images: list.filter((a) => a.kind === "imagem").length, videos: list.filter((a) => a.kind === "video_drive").length, caption: (item?.caption as string) ?? "" };
    for (const a of ((accounts ?? []) as { id: string; platform: SchedulePlatform; name: string }[]).filter((x) => input.accountIds.includes(x.id))) {
      const problem = publishProblem(a.platform, counts);
      if (problem) return fail("business_rule", `${a.name}: ${problem}`);
    }
    must(await supabase.rpc("content_schedule", { p_content: input.id, p_accounts: input.accountIds, p_at: zonedIso(input.date, input.time) }));
    refresh(input.id);
    return ok(null, "Publicação agendada.");
  },
);

export const rescheduleContent = defineAction({ schema: z.object({ id: z.uuid(), contentId: z.uuid().optional(), date: z.iso.date(), time: z.string().regex(/^\d{2}:\d{2}$/) }), permission: "content.publish" }, async (input) => {
  const supabase = await createClient();
  must(await supabase.rpc("content_reschedule", { p_schedule: input.id, p_at: zonedIso(input.date, input.time) }));
  refresh(input.contentId);
  return ok(null, "Publicação reagendada.");
});

export const cancelSchedule = defineAction({ schema: z.object({ id: z.uuid(), contentId: z.uuid().optional() }), permission: "content.publish" }, async ({ id, contentId }) => {
  const supabase = await createClient();
  must(await supabase.rpc("content_cancel_schedule", { p_schedule: id }));
  refresh(contentId);
  return ok(null, "Agendamento cancelado.");
});

export const setSocialSelected = defineAction({ schema: z.object({ id: z.uuid(), selected: z.boolean() }), permission: "content.publish" }, async ({ id, selected }, { user }) => {
  must(await createAdminClient().from("social_accounts").update({ selected, updated_at: new Date().toISOString() }).eq("id", id).eq("organization_id", user.organizationId));
  revalidatePath("/conteudo");
  return ok(null);
});

export const disconnectSocial = defineAction({ schema: z.object({}), permission: "content.publish" }, async (_, { user }) => {
  const admin = createAdminClient();
  const { data: conn } = await admin.from("integration_connections").select("token_enc").eq("organization_id", user.organizationId).eq("provider", "meta_social").maybeSingle();
  if (conn) await socialRevoke(decrypt(conn.token_enc));
  const { data: accounts } = await admin.from("social_accounts").update({ status: "desconectada", token_enc: "revogado", updated_at: new Date().toISOString() }).eq("organization_id", user.organizationId).select("id");
  // Quem estava agendado precisa de atenção: sem conta, não há como publicar.
  const ids = (accounts ?? []).map((a) => a.id as string);
  if (ids.length) {
    const { data: open } = await admin.from("content_schedules").select("id").in("account_id", ids).eq("status", "agendado");
    for (const s of open ?? []) await admin.rpc("content_finish", { p_schedule: s.id, p_status: "erro", p_external: null, p_permalink: null, p_error: "A conta Meta foi desconectada. Reconecte e agende de novo." });
  }
  await admin.from("integration_connections").delete().eq("organization_id", user.organizationId).eq("provider", "meta_social");
  refresh();
  revalidatePath("/anuncios/contas");
  return ok(null, "Conta Meta desconectada.");
});

// --- Decisão do cliente: sem sessão, a autorização é o próprio link ----------------

const DECISION_MESSAGES: Record<string, string> = {
  link_invalido: "Este link não vale mais. Peça um novo à equipe.",
  ja_decidido: "Este conteúdo mudou ou já recebeu uma decisão. Atualize a página.",
  comentario_obrigatorio: "Conte o que precisa ser ajustado.",
};

export async function decideContent(raw: { token: string; decision: "aprovado" | "ajustes"; comment: string; name: string }) {
  const parsed = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32,100}$/), decision: z.enum(["aprovado", "ajustes"]), comment: z.string().trim().max(4000, "O comentário está muito longo."), name: z.string().trim().min(2, "Informe seu nome.").max(120) }).safeParse(raw);
  if (!parsed.success) return fail("validation", parsed.error.issues[0]?.message ?? "Confira os dados.");
  if (!(await withinRateLimit(`aprovacao:${await clientIp()}`, 20, 600))) return fail("business_rule", RATE_LIMIT_MESSAGE);
  const { data, error } = await createAdminClient().rpc("content_decide", { p_token_hash: hashToken(parsed.data.token), p_decision: parsed.data.decision, p_comment: parsed.data.comment, p_name: parsed.data.name });
  if (error) return fail("unknown", "Não foi possível registrar agora. Tente de novo.");
  if (data !== "ok") return fail("business_rule", DECISION_MESSAGES[data as string] ?? "Não foi possível registrar.");
  revalidatePath("/conteudo");
  return ok(null, parsed.data.decision === "aprovado" ? "Aprovação registrada. Obrigado!" : "Pedido de ajustes enviado à equipe.");
}
