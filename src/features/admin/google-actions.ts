"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { googleConfigured, listGoogleCalendars, revoke, syncUser, unwatchCalendar } from "@/lib/google/calendar";
import { fail, ok } from "@/domain/shared/result";

const empty = z.object({});

export const syncGoogleNow = defineAction({ schema: empty, permission: "calendar.manage" }, async (_input, { user }) => {
  if (!googleConfigured()) return fail("business_rule", "A integração com o Google ainda não foi configurada no servidor.");
  try {
    const r = await syncUser(user.id);
    revalidatePath("/agenda");
    revalidatePath("/configuracoes/integracoes");
    return ok(r, `Sincronizado: ${r.pushed} enviado(s), ${r.pulled} recebido(s).`);
  } catch {
    revalidatePath("/configuracoes/integracoes");
    return fail("network", "Não foi possível sincronizar com o Google agora. Tente novamente.");
  }
});

export const disconnectGoogle = defineAction({ schema: empty }, async (_input, { user }) => {
  if (!googleConfigured()) return fail("business_rule", "Integração não configurada.");
  const admin = createAdminClient();
  await unwatchCalendar(user.id);
  const { data } = await admin.from("google_calendar_connections").select("refresh_token_enc").eq("user_id", user.id).maybeSingle();
  if (data?.refresh_token_enc) await revoke(data.refresh_token_enc);
  await admin.from("google_calendar_connections").delete().eq("user_id", user.id);
  // Eventos vindos do Google continuam na agenda, mas deixam de sincronizar.
  await admin.from("calendar_events").update({ google_event_id: null, google_etag: null }).eq("owner_id", user.id);
  await admin.from("tasks").update({ google_event_id: null, google_etag: null }).eq("owner_id", user.id);
  revalidatePath("/configuracoes/integracoes");
  return ok(null, "Google Agenda desconectado e acesso revogado.");
});

export const getGoogleCalendars = defineAction({ schema: empty, permission: "calendar.read" }, async (_input, { user }) => {
  const items = await listGoogleCalendars(user.id).catch(() => null);
  if (!items) return fail("business_rule", "Reconecte o Google Agenda para escolher as agendas (permissão nova necessária).");
  return ok(items);
});

export const setBusyCalendars = defineAction(
  { schema: z.object({ ids: z.array(z.string().min(1).max(300)).min(1, "Escolha ao menos uma agenda.").max(30) }), permission: "calendar.read" },
  async ({ ids }, { user }) => {
    if (!googleConfigured()) return fail("business_rule", "Integração não configurada.");
    const admin = createAdminClient();
    const { error } = await admin.from("google_calendar_connections").update({ busy_calendar_ids: ids }).eq("user_id", user.id);
    if (error) throw error;
    revalidatePath("/configuracoes/integracoes");
    return ok(null, "Agendas de disponibilidade salvas.");
  },
);
