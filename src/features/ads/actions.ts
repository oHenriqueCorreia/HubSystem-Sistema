"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto";
import { fail, ok } from "@/domain/shared/result";
import { metaRevoke } from "@/lib/ads/meta";
import { syncAds } from "@/lib/ads/sync";
import { clientIp, RATE_LIMIT_MESSAGE, withinRateLimit } from "@/lib/rate-limit";

const provider = z.enum(["meta_ads", "google_ads"]);

export const syncAdsNow = defineAction({ schema: z.object({ provider }), permission: "ads.manage" }, async (input, { user }) => {
  if (!(await withinRateLimit(`ads-sync:${user.organizationId}:${input.provider}`, 6, 3600))) return fail("business_rule", RATE_LIMIT_MESSAGE);
  try {
    const r = await syncAds(user.organizationId, input.provider);
    revalidatePath("/anuncios", "layout");
    return ok(r, `Sincronizado: ${r.accounts} conta(s), ${r.metrics} registro(s) de métricas.`);
  } catch {
    revalidatePath("/anuncios", "layout");
    return fail("network", "Não foi possível sincronizar agora. Veja a situação da conexão e tente novamente.");
  }
});

export const disconnectAds = defineAction({ schema: z.object({ provider }), permission: "ads.manage" }, async (input, { user }) => {
  const admin = createAdminClient();
  const { data } = await admin.from("integration_connections").select("token_enc").eq("organization_id", user.organizationId).eq("provider", input.provider).maybeSingle();
  if (data?.token_enc && input.provider === "meta_ads") await metaRevoke(decrypt(data.token_enc));
  await admin.from("integration_connections").delete().eq("organization_id", user.organizationId).eq("provider", input.provider);
  // Métricas já trazidas continuam para consulta; a conta deixa de sincronizar.
  await admin.from("ad_accounts").update({ is_selected: false }).eq("organization_id", user.organizationId).eq("provider", input.provider);
  revalidatePath("/anuncios", "layout");
  return ok(null, "Conta desconectada. O acesso foi revogado.");
});

export const setAdAccountSelected = defineAction({ schema: z.object({ id: z.uuid(), selected: z.boolean() }), permission: "ads.manage" }, async (input, { user }) => {
  const supabase = await createClient();
  const res = must(await supabase.from("ad_accounts").update({ is_selected: input.selected }).eq("id", input.id).select("id, provider")) as { id: string; provider: "meta_ads" | "google_ads" }[];
  if (!res.length) return fail("forbidden", "Conta não encontrada.");
  if (!input.selected) {
    revalidatePath("/anuncios", "layout");
    return ok(null, "Conta removida dos relatórios.");
  }
  // Traz campanhas, anúncios e 90 dias de métricas da conta na hora.
  try {
    const r = await syncAds(user.organizationId, res[0].provider, input.id);
    revalidatePath("/anuncios", "layout");
    return ok(null, `Conta ativada e sincronizada: ${r.metrics} registro(s) de métricas.`);
  } catch {
    revalidatePath("/anuncios", "layout");
    return ok(null, "Conta ativada, mas a sincronização falhou agora. Clique em “Sincronizar agora” em alguns minutos.");
  }
});

export const setAccountClient = defineAction({ schema: z.object({ id: z.uuid(), clientId: z.uuid().nullable() }), permission: "ads.manage" }, async (input) => {
  const supabase = await createClient();
  const res = must(await supabase.from("ad_accounts").update({ ad_client_id: input.clientId }).eq("id", input.id).select("id")) as { id: string }[];
  if (!res.length) return fail("forbidden", "Conta não encontrada.");
  revalidatePath("/anuncios", "layout");
  return ok(null, input.clientId ? "Conta ligada ao cliente." : "Conta sem cliente.");
});

const clientName = z.string().trim().min(1, "Informe o nome do cliente.").max(120);

// systemClientId liga o grupo de contas ao cliente do sistema: quem trabalha nele vê os anúncios (escopo menor que "todos").
const systemClientId = z.uuid().nullable().default(null);

export const createAdClient = defineAction({ schema: z.object({ name: clientName, accountIds: z.array(z.uuid()).max(100).default([]), systemClientId }), permission: "ads.manage" }, async (input) => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("ad_clients").insert({ name: input.name, client_id: input.systemClientId }).select("id").single();
  if (error?.code === "23505") return fail("conflict", error.message.includes("client_uq") ? "Esse cliente do sistema já está ligado a outro cliente de anúncios." : "Já existe um cliente com esse nome.");
  if (error) throw error;
  if (input.accountIds.length) must(await supabase.from("ad_accounts").update({ ad_client_id: data.id }).in("id", input.accountIds));
  revalidatePath("/anuncios", "layout");
  return ok({ id: data.id as string }, "Cliente criado.");
});

export const renameAdClient = defineAction({ schema: z.object({ id: z.uuid(), name: clientName, systemClientId }), permission: "ads.manage" }, async (input) => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("ad_clients").update({ name: input.name, client_id: input.systemClientId }).eq("id", input.id).select("id");
  if (error?.code === "23505") return fail("conflict", error.message.includes("client_uq") ? "Esse cliente do sistema já está ligado a outro cliente de anúncios." : "Já existe um cliente com esse nome.");
  if (error) throw error;
  if (!data?.length) return fail("forbidden", "Você não pode alterar este cliente.");
  revalidatePath("/anuncios", "layout");
  return ok(null, "Cliente atualizado.");
});

export const deleteAdClient = defineAction({ schema: z.object({ id: z.uuid() }), permission: "ads.manage" }, async (input) => {
  const supabase = await createClient();
  must(await supabase.from("ad_clients").delete().eq("id", input.id));
  revalidatePath("/anuncios", "layout");
  return ok(null, "Cliente excluído. As contas continuam conectadas, sem cliente.");
});

const utmText = (max: number) => z.string().trim().max(max);

export const saveUtmLink = defineAction(
  {
    schema: z.object({
      name: z.string().trim().min(1, "Dê um nome para o link.").max(120),
      clientId: z.uuid().nullable(),
      baseUrl: z.url("Informe a URL completa, começando com https://").max(2000).refine((u) => /^https?:\/\//.test(u), "A URL precisa começar com http:// ou https://"),
      source: utmText(200).min(1, "Informe a origem (utm_source)."),
      medium: utmText(200).min(1, "Informe a mídia (utm_medium)."),
      campaign: utmText(300).min(1, "Informe a campanha (utm_campaign)."),
      content: utmText(300),
      term: utmText(300),
    }),
    permission: "ads.manage",
  },
  async (input) => {
    const supabase = await createClient();
    must(
      await supabase.from("utm_links").insert({
        name: input.name,
        ad_client_id: input.clientId,
        base_url: input.baseUrl,
        utm_source: input.source,
        utm_medium: input.medium,
        utm_campaign: input.campaign,
        utm_content: input.content || null,
        utm_term: input.term || null,
      }),
    );
    revalidatePath("/anuncios/utms");
    return ok(null, "Link salvo.");
  },
);

export const deleteUtmLink = defineAction({ schema: z.object({ id: z.uuid() }), permission: "ads.manage" }, async (input) => {
  const supabase = await createClient();
  must(await supabase.from("utm_links").delete().eq("id", input.id));
  revalidatePath("/anuncios/utms");
  return ok(null, "Link excluído.");
});

const cents = z.number().int().min(0).max(100_000_000_000).nullable();

export const setAdAlerts = defineAction(
  { schema: z.object({ id: z.uuid(), balanceBelowCents: cents, dailySpendAboveCents: cents }), permission: "ads.manage" },
  async (input, { user }) => {
    if (!(await withinRateLimit(`ads-alert:${user.id}:${await clientIp()}`, 60, 3600))) return fail("business_rule", RATE_LIMIT_MESSAGE);
    const supabase = await createClient();
    must(
      await supabase
        .from("ad_accounts")
        .update({ alert_balance_below_cents: input.balanceBelowCents, alert_daily_spend_above_cents: input.dailySpendAboveCents })
        .eq("id", input.id),
    );
    revalidatePath("/anuncios", "layout");
    return ok(null, "Alertas salvos. Você será notificado na central de notificações.");
  },
);
