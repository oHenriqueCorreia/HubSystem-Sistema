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
    revalidatePath("/anuncios");
    return ok(r, `Sincronizado: ${r.accounts} conta(s), ${r.metrics} registro(s) de métricas.`);
  } catch {
    revalidatePath("/anuncios");
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
  revalidatePath("/anuncios");
  return ok(null, "Conta desconectada. O acesso foi revogado.");
});

export const setAdAccountSelected = defineAction({ schema: z.object({ id: z.uuid(), selected: z.boolean() }), permission: "ads.manage" }, async (input) => {
  const supabase = await createClient();
  const res = must(await supabase.from("ad_accounts").update({ is_selected: input.selected }).eq("id", input.id).select("id")) as { id: string }[];
  if (!res.length) return fail("forbidden", "Conta não encontrada.");
  revalidatePath("/anuncios");
  return ok(null, input.selected ? "Conta selecionada. Sincronize para trazer as campanhas." : "Conta removida dos relatórios.");
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
    revalidatePath("/anuncios");
    return ok(null, "Alertas salvos. Você será notificado na central de notificações.");
  },
);
