"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, must } from "@/lib/actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, encrypt } from "@/lib/crypto";
import { publicEnv } from "@/lib/env";
import { fail, ok } from "@/domain/shared/result";
import { displayPhoneFromMe, sessionNameFor, validWahaUrl } from "@/domain/whatsapp/waha";
import { wahaHistoryReady, wahaPing, wahaQr, wahaResetForHistory, wahaRestart, wahaSession, wahaStartSession, type WahaConn } from "@/lib/waha";
import { runImportStep } from "@/lib/whatsapp-import";

const webhookUrl = (numberId: string) => `${publicEnv.NEXT_PUBLIC_SITE_URL}/api/whatsapp/waha/${numberId}`;

const refresh = () => {
  revalidatePath("/atendimento");
  revalidatePath("/configuracoes/integracoes");
};

/** Número por QR desta organização, com a conexão já decifrada. */
async function loadQrNumber(id: string, organizationId: string) {
  const { data } = await createAdminClient().from("whatsapp_numbers").select("id, organization_id, provider, status, waha_url, waha_session, token_enc, webhook_secret_enc").eq("id", id).maybeSingle();
  if (!data || data.organization_id !== organizationId || data.provider !== "waha") return null;
  const conn: WahaConn = { url: data.waha_url as string, key: decrypt(data.token_enc), session: data.waha_session as string };
  return { conn, status: data.status as string, secret: decrypt(data.webhook_secret_enc as string) };
}

/**
 * Liga um servidor WAHA e inicia a sessão que gera o QR Code.
 * Com numberId, reaproveita o número desconectado: as conversas antigas continuam nele.
 */
export const connectQrNumber = defineAction(
  {
    schema: z.object({
      url: z.string().trim().min(8, "Informe o endereço do servidor.").max(300).optional(),
      apiKey: z.string().trim().min(8, "Informe a chave do servidor.").max(500).optional(),
      numberId: z.uuid().optional(),
    }),
    permission: "inbox.manage",
  },
  async (input, { user }) => {
    const rawUrl = input.url ?? process.env.WAHA_URL;
    const apiKey = input.apiKey ?? process.env.WAHA_API_KEY;
    if (!rawUrl || !apiKey) return fail("validation", "O servidor WAHA ainda não foi configurado.");
    const url = validWahaUrl(rawUrl, process.env.NODE_ENV !== "production");
    if (!url) return fail("validation", "Use o endereço público do servidor, começando com https://.");
    try {
      await wahaPing({ url, key: apiKey });
    } catch (e) {
      const status = (e as { status?: number }).status;
      return fail("validation", status === 401 || status === 403 ? "O servidor recusou esta chave. Confira a chave e tente de novo." : "Não foi possível falar com o servidor. Confira o endereço e se ele está ligado.");
    }

    const admin = createAdminClient();
    if (input.numberId) {
      const { data: old } = await admin.from("whatsapp_numbers").select("organization_id, provider").eq("id", input.numberId).maybeSingle();
      if (!old || old.organization_id !== user.organizationId || old.provider !== "waha") return fail("not_found", "Número não encontrado.");
    }
    const id = input.numberId ?? randomUUID();
    const session = sessionNameFor(id);
    const secret = randomBytes(32).toString("hex");
    must(
      await admin.from("whatsapp_numbers").upsert(
        {
          id,
          organization_id: user.organizationId,
          provider: "waha",
          waha_url: url,
          waha_session: session,
          token_enc: encrypt(apiKey),
          webhook_secret_enc: encrypt(secret),
          status: "aguardando_qr",
          last_error: null,
          connected_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      ),
    );
    try {
      await wahaStartSession({ url, key: apiKey, session }, webhookUrl(id), secret);
    } catch {
      if (input.numberId) await admin.from("whatsapp_numbers").update({ status: "erro", last_error: "O servidor não iniciou a sessão." }).eq("id", id);
      else await admin.from("whatsapp_numbers").delete().eq("id", id);
      refresh();
      return fail("network", "O servidor não conseguiu iniciar a sessão. Confira se ele está atualizado e tente de novo.");
    }
    refresh();
    return ok({ id });
  },
);

export type QrState = { state: "starting" } | { state: "qr"; image: string } | { state: "connected"; phone: string } | { state: "failed" } | { state: "unreachable" };

/** Situação da sessão e o QR atual. A tela consulta a cada poucos segundos. */
export const getQrState = defineAction({ schema: z.object({ id: z.uuid() }), permission: "inbox.manage" }, async ({ id }, { user }) => {
  const number = await loadQrNumber(id, user.organizationId);
  if (!number) return fail("not_found", "Número não encontrado.");
  try {
    const session = await wahaSession(number.conn);
    if (session.status === "WORKING") {
      const phone = displayPhoneFromMe(session.me?.id ?? null);
      await createAdminClient()
        .from("whatsapp_numbers")
        .update({ status: "ativo", last_error: null, updated_at: new Date().toISOString(), ...(phone ? { display_phone: phone } : {}), ...(session.me?.pushName ? { verified_name: session.me.pushName } : {}) })
        .eq("id", id);
      refresh();
      return ok<QrState>({ state: "connected", phone });
    }
    if (session.status === "FAILED" || session.status === "STOPPED") return ok<QrState>({ state: "failed" });
    if (session.status === "SCAN_QR_CODE") {
      const image = await wahaQr(number.conn);
      return ok<QrState>(image ? { state: "qr", image } : { state: "starting" });
    }
    return ok<QrState>({ state: "starting" });
  } catch {
    return ok<QrState>({ state: "unreachable" });
  }
});

/** Gera um QR novo: os códigos expiram, e a sessão para depois de algumas tentativas. */
export const reconnectQrNumber = defineAction({ schema: z.object({ id: z.uuid() }), permission: "inbox.manage" }, async ({ id }, { user }) => {
  const number = await loadQrNumber(id, user.organizationId);
  if (!number) return fail("not_found", "Número não encontrado.");
  if (number.status === "desconectado") return fail("business_rule", "Este número foi desconectado. Informe o servidor e a chave de novo.");
  try {
    await wahaRestart(number.conn).catch(async (e) => {
      if ((e as { status?: number }).status !== 404) throw e;
      await wahaStartSession(number.conn, webhookUrl(id), number.secret);
    });
  } catch {
    return fail("network", "Não foi possível falar com o servidor. Confira se ele está ligado.");
  }
  await createAdminClient().from("whatsapp_numbers").update({ status: "aguardando_qr", last_error: null, updated_at: new Date().toISOString() }).eq("id", id);
  refresh();
  return ok(null);
});

export type ImportJob = { id: string; status: "importando" | "aguardando" | "concluida" | "erro" | "cancelada"; include_contacts: boolean; include_groups: boolean; pass: number; contacts_done: number; groups_done: number; skipped: number; messages_done: number; last_error: string | null };
const JOB_COLUMNS = "id, status, include_contacts, include_groups, pass, contacts_done, groups_done, skipped, messages_done, last_error";
/** Quanto cada chamada trabalha. A tela chama de novo até terminar; sem a tela, a rodada automática continua. */
const STEP_MS = 25_000;

async function latestJob(numberId: string) {
  const { data } = await createAdminClient().from("whatsapp_imports").select(JOB_COLUMNS).eq("number_id", numberId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data as ImportJob | null;
}

/** Diz se o número já pode compilar ou se precisa ler o QR Code de novo, e como está a última compilação. */
export const getHistoryState = defineAction({ schema: z.object({ id: z.uuid() }), permission: "inbox.manage" }, async ({ id }, { user }) => {
  const number = await loadQrNumber(id, user.organizationId);
  if (!number) return fail("not_found", "Número não encontrado.");
  try {
    const session = await wahaSession(number.conn);
    return ok({ ready: wahaHistoryReady(session) && session.status === "WORKING", job: await latestJob(id) });
  } catch {
    return fail("network", "Não foi possível falar com o servidor do WhatsApp. Confira se ele está ligado.");
  }
});

/** O histórico só vem no momento do QR Code: sai do aparelho e prepara uma leitura nova. */
export const prepareHistorySync = defineAction({ schema: z.object({ id: z.uuid() }), permission: "inbox.manage" }, async ({ id }, { user }) => {
  const number = await loadQrNumber(id, user.organizationId);
  if (!number) return fail("not_found", "Número não encontrado.");
  if (number.status === "desconectado") return fail("business_rule", "Este número foi desconectado. Conecte de novo pelo QR Code.");
  try {
    await wahaResetForHistory(number.conn, webhookUrl(id), number.secret);
  } catch {
    return fail("network", "Não foi possível falar com o servidor do WhatsApp. Confira se ele está ligado.");
  }
  await createAdminClient().from("whatsapp_numbers").update({ status: "aguardando_qr", last_error: null, updated_at: new Date().toISOString() }).eq("id", id);
  refresh();
  return ok(null);
});

export const startHistoryImport = defineAction({ schema: z.object({ id: z.uuid(), contacts: z.boolean(), groups: z.boolean() }).refine((v) => v.contacts || v.groups, "Escolha conversas, grupos ou os dois."), permission: "inbox.manage" }, async ({ id, contacts, groups }, { user }) => {
  const number = await loadQrNumber(id, user.organizationId);
  if (!number) return fail("not_found", "Número não encontrado.");
  const admin = createAdminClient();
  const { data: created, error } = await admin
    .from("whatsapp_imports")
    .insert({ organization_id: user.organizationId, number_id: id, include_contacts: contacts, include_groups: groups, created_by: user.id })
    .select(JOB_COLUMNS)
    .maybeSingle();
  // Já existe uma em andamento: acompanha a que está rodando em vez de começar outra.
  if (error && error.code !== "23505") return fail("network", "Não foi possível começar a compilação.");
  const job = (created as ImportJob | null) ?? (await latestJob(id));
  return job ? ok(job) : fail("network", "Não foi possível começar a compilação.");
});

export const continueHistoryImport = defineAction({ schema: z.object({ id: z.uuid(), jobId: z.uuid() }), permission: "inbox.manage" }, async ({ id, jobId }, { user }) => {
  const admin = createAdminClient();
  const { data: job } = await admin.from("whatsapp_imports").select("organization_id, number_id").eq("id", jobId).maybeSingle();
  if (!job || job.organization_id !== user.organizationId || job.number_id !== id) return fail("not_found", "Compilação não encontrada.");
  await runImportStep(jobId, STEP_MS);
  revalidatePath("/atendimento");
  const { data } = await admin.from("whatsapp_imports").select(JOB_COLUMNS).eq("id", jobId).single();
  return ok(data as ImportJob);
});

export const cancelHistoryImport = defineAction({ schema: z.object({ jobId: z.uuid() }), permission: "inbox.manage" }, async ({ jobId }, { user }) => {
  await createAdminClient().from("whatsapp_imports").update({ status: "cancelada", finished_at: new Date().toISOString(), lease_until: null }).eq("id", jobId).eq("organization_id", user.organizationId).in("status", ["importando", "aguardando"]);
  revalidatePath("/atendimento");
  return ok(null, "Compilação interrompida. O que já entrou continua no Atendimento.");
});
