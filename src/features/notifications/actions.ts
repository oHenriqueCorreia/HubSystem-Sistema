"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { fail, ok } from "@/domain/shared/result";
import { getPushKeys, sendPush } from "@/lib/push";
import { notificationPrefsSchema } from "./types";

export type NotificationItem = { id: string; kind: string; title: string; body: string | null; href: string | null; read_at: string | null; created_at: string };

export const listMyNotifications = defineAction({ schema: z.object({}) }, async () => {
  const supabase = await createClient();
  const data = must(
    await supabase.from("notifications").select("id, kind, title, body, href, read_at, created_at").order("read_at", { nullsFirst: true }).order("created_at", { ascending: false }).limit(50),
  ) as NotificationItem[];
  return ok(data ?? []);
});

export const markNotificationsRead = defineAction({ schema: z.object({ ids: z.array(z.uuid()).max(100).optional() }) }, async ({ ids }, { user }) => {
  const supabase = await createClient();
  let q = supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).is("read_at", null);
  if (ids?.length) q = q.in("id", ids);
  must(await q);
  return ok(null);
});

/** Chave pública para o navegador inscrever este aparelho. */
export const getPushPublicKey = defineAction({ schema: z.object({}) }, async () => ok((await getPushKeys()).public));

export const savePushSubscription = defineAction(
  { schema: z.object({ endpoint: z.url().max(1000), p256dh: z.string().min(1).max(300), auth: z.string().min(1).max(100), userAgent: z.string().max(300) }) },
  async (input) => {
    const supabase = await createClient();
    must(await supabase.rpc("save_push_subscription", { p_endpoint: input.endpoint, p_p256dh: input.p256dh, p_auth: input.auth, p_user_agent: input.userAgent }));
    return ok(null, "Notificações ativadas neste aparelho.");
  },
);

export const removePushSubscription = defineAction({ schema: z.object({ endpoint: z.url().max(1000) }) }, async ({ endpoint }) => {
  const supabase = await createClient();
  must(await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint));
  return ok(null, "Notificações desativadas neste aparelho.");
});

export const sendTestPush = defineAction({ schema: z.object({}) }, async (_input, { user }) => {
  const r = await sendPush([{ userId: user.id, payload: { title: "Notificações ativas", body: "É assim que seus lembretes vão chegar neste aparelho.", href: "/configuracoes/notificacoes", tag: "teste" } }]);
  if (!r.sent) return fail("network", "Nenhum aparelho recebeu. Ative as notificações neste aparelho e tente de novo.");
  return ok(null, r.sent === 1 ? "Notificação enviada." : `Notificação enviada para ${r.sent} aparelhos.`);
});

export const saveNotificationPrefs = defineAction({ schema: notificationPrefsSchema }, async (input, { user }) => {
  const supabase = await createClient();
  const current = must(await supabase.from("profiles").select("preferences").eq("id", user.id).single()) as { preferences: Record<string, unknown> | null };
  must(await supabase.from("profiles").update({ preferences: { ...(current.preferences ?? {}), notificacoes: input } }).eq("id", user.id));
  revalidatePath("/configuracoes/notificacoes");
  return ok(null, "Preferências salvas.");
});
