"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok } from "@/domain/shared/result";
import { metaCreateCampaign, metaPages, metaSearchLocations } from "@/lib/ads/meta";
import { accessToken, getConnection } from "@/lib/ads/tokens";
import { syncAds } from "@/lib/ads/sync";
import { RATE_LIMIT_MESSAGE, withinRateLimit } from "@/lib/rate-limit";

async function metaToken(organizationId: string) {
  const conn = await getConnection(organizationId, "meta_ads");
  if (!conn || conn.status !== "ativa") return null;
  return accessToken(conn).catch(() => null);
}

const metaMessage = (e: unknown) => {
  const err = e as { userMessage?: string; code?: number };
  if (err.code === 200 || err.code === 10) return "A Meta não deu permissão. Reconecte a Meta em Anúncios → Contas aceitando “gerenciar anúncios”.";
  return err.userMessage ? `A Meta recusou: ${err.userMessage}` : "A Meta não respondeu agora. Tente de novo em alguns minutos.";
};

export const loadMetaPages = defineAction({ schema: z.object({}), permission: "ads.manage" }, async (_i, { user }) => {
  const token = await metaToken(user.organizationId);
  if (!token) return fail("business_rule", "Conecte a Meta em Anúncios → Contas.");
  try {
    return ok(await metaPages(token));
  } catch (e) {
    return fail("network", metaMessage(e));
  }
});

export const searchMetaLocations = defineAction({ schema: z.object({ q: z.string().trim().min(2).max(80) }), permission: "ads.manage" }, async (input, { user }) => {
  if (!(await withinRateLimit(`ads-geo:${user.id}`, 120, 600))) return fail("business_rule", RATE_LIMIT_MESSAGE);
  const token = await metaToken(user.organizationId);
  if (!token) return fail("business_rule", "Conecte a Meta em Anúncios → Contas.");
  try {
    return ok(await metaSearchLocations(token, input.q));
  } catch (e) {
    return fail("network", metaMessage(e));
  }
});

const schema = z
  .object({
    accountId: z.uuid(),
    objective: z.enum(["trafego", "alcance", "whatsapp"]),
    name: z.string().trim().min(3, "Dê um nome à campanha.").max(200),
    dailyBudgetCents: z.number().int().min(600, "A Meta pede pelo menos R$ 6,00 por dia.").max(100_000_000),
    active: z.boolean(),
    countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(10),
    cities: z.array(z.object({ key: z.string().regex(/^\d+$/), radiusKm: z.number().int().min(1).max(80) })).max(50),
    regions: z.array(z.string().regex(/^\d+$/)).max(30),
    ageMin: z.number().int().min(18).max(65),
    ageMax: z.number().int().min(18).max(65),
    genders: z.array(z.enum(["homens", "mulheres"])).max(2),
    pageId: z.string().regex(/^\d+$/, "Escolha a página do Facebook."),
    imageBase64: z.string().max(5_000_000, "A imagem precisa ter até 3,5 MB.").nullable(),
    message: z.string().trim().min(1, "Escreva o texto do anúncio.").max(2000),
    headline: z.string().trim().max(255),
    link: z.string().trim().max(2000).nullable(),
    cta: z.enum(["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "CONTACT_US", "GET_QUOTE", "BOOK_TRAVEL", "WHATSAPP_MESSAGE"]),
    validateOnly: z.boolean().default(false),
  })
  .refine((v) => v.ageMin <= v.ageMax, { message: "A idade mínima passa da máxima.", path: ["ageMin"] })
  .refine((v) => v.countries.length + v.cities.length + v.regions.length > 0, { message: "Escolha pelo menos um local.", path: ["countries"] })
  .refine((v) => v.objective === "whatsapp" || (v.link && /^https?:\/\//.test(v.link)), { message: "Informe o link de destino, começando com https://", path: ["link"] });

export const createMetaCampaign = defineAction({ schema, permission: "ads.manage" }, async (input, { user }) => {
  if (!(await withinRateLimit(`ads-create:${user.id}`, 20, 3600))) return fail("business_rule", RATE_LIMIT_MESSAGE);
  // A conta é lida com o acesso da pessoa: só cria em conta que ela enxerga.
  const supabase = await createClient();
  const { data: account } = await supabase.from("ad_accounts").select("id, external_id, provider, name").eq("id", input.accountId).maybeSingle();
  if (!account || account.provider !== "meta_ads") return fail("forbidden", "Conta não encontrada.");
  const token = await metaToken(user.organizationId);
  if (!token) return fail("business_rule", "A conexão com a Meta expirou. Reconecte em Anúncios → Contas.");
  try {
    const r = await metaCreateCampaign(
      token,
      {
        accountId: account.external_id,
        objective: input.objective,
        name: input.name,
        dailyBudgetCents: input.dailyBudgetCents,
        active: input.active,
        geo: { countries: input.countries, cities: input.cities, regions: input.regions },
        ageMin: input.ageMin,
        ageMax: input.ageMax,
        genders: input.genders,
        pageId: input.pageId,
        image: input.imageBase64 ? { bytes: input.imageBase64 } : null,
        message: input.message,
        headline: input.headline,
        link: input.link,
        cta: input.cta,
      },
      input.validateOnly,
    );
    if (r.validated) return ok({ campaignId: null }, "A Meta conferiu a campanha: está tudo certo para publicar.");
    await createAdminClient()
      .from("audit_logs")
      .insert({ organization_id: user.organizationId, actor_id: user.id, action: "ads_create", entity_type: "ad_campaigns", entity_id: r.campaignId, changes: { nome: input.name, conta: account.name, ativa: input.active } });
    await syncAds(user.organizationId, "meta_ads", account.id).catch(() => null);
    revalidatePath("/anuncios", "layout");
    return ok({ campaignId: r.campaignId }, input.active ? "Campanha publicada. A Meta revisa o anúncio antes de veicular." : "Campanha criada pausada. Ative quando quiser.");
  } catch (e) {
    return fail("network", metaMessage(e));
  }
});
