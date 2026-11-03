import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, encrypt } from "@/lib/crypto";
import { publicEnv } from "@/lib/env";

type Keys = { public: string; private: string };
export type PushPayload = { title: string; body?: string | null; href?: string | null; tag?: string };
type Subscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

/** Chaves VAPID do sistema: criadas no primeiro uso e guardadas no banco (a privada, cifrada). */
export async function getPushKeys(): Promise<Keys> {
  const admin = createAdminClient();
  const read = async () => {
    const { data, error } = await admin.rpc("push_get_keys");
    if (error) throw error;
    return data as { public: string | null; private_enc: string | null };
  };
  let saved = await read();
  if (!saved.public || !saved.private_enc) {
    const fresh = webpush.generateVAPIDKeys();
    const { error } = await admin.rpc("push_set_keys", { p_public: fresh.publicKey, p_private_enc: encrypt(fresh.privateKey) });
    if (error) throw error;
    // Outro pedido pode ter gravado antes: vale o que está no banco.
    saved = await read();
  }
  return { public: saved.public!, private: decrypt(saved.private_enc!) };
}

// O padrão exige https; em desenvolvimento usa o endereço de produção.
const subject = () => (publicEnv.NEXT_PUBLIC_SITE_URL.startsWith("https://") ? publicEnv.NEXT_PUBLIC_SITE_URL : "https://hubsystem-phi.vercel.app");

/** Envia para os aparelhos dos usuários indicados e remove inscrições que deixaram de existir. */
export async function sendPush(messages: { userId: string; payload: PushPayload }[]) {
  if (!messages.length) return { sent: 0, failed: 0 };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", [...new Set(messages.map((m) => m.userId))]);
  if (error) throw error;

  const keys = await getPushKeys();
  const vapidDetails = { subject: subject(), publicKey: keys.public, privateKey: keys.private };
  const byUser = new Map<string, Subscription[]>();
  for (const s of (data ?? []) as Subscription[]) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

  const gone: string[] = [];
  let sent = 0;
  let failed = 0;
  await Promise.all(
    messages.flatMap(({ userId, payload }) =>
      (byUser.get(userId) ?? []).map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { vapidDetails, TTL: 6 * 3600 });
          sent++;
        } catch (e) {
          failed++;
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) gone.push(s.id);
          else console.error("[push] falha no envio", status ?? "erro");
        }
      }),
    ),
  );
  if (gone.length) await admin.from("push_subscriptions").delete().in("id", gone);
  return { sent, failed };
}
