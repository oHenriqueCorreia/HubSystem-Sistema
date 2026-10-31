"use server";

import { z } from "zod";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { ok } from "@/domain/shared/result";

export type NotificationItem = { id: string; kind: string; title: string; body: string | null; href: string | null; read_at: string | null; created_at: string };

/** Lista as notificações (opcionalmente gerando as do dia antes). */
export const listMyNotifications = defineAction({ schema: z.object({ refresh: z.boolean().default(false) }) }, async ({ refresh }) => {
  const supabase = await createClient();
  if (refresh) await supabase.rpc("refresh_my_notifications");
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
