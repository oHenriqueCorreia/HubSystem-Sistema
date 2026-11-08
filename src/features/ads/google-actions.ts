"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok } from "@/domain/shared/result";
import { googleAdsAddKeyword, googleAdsAddNegative, googleAdsKeywordIdeas, googleAdsSetKeywordStatus } from "@/lib/ads/google-ads";
import { accessToken, getConnection } from "@/lib/ads/tokens";
import { RATE_LIMIT_MESSAGE, withinRateLimit } from "@/lib/rate-limit";

const id = z.string().regex(/^\d{1,20}$/);
const matchType = z.enum(["EXACT", "PHRASE", "BROAD"]);
const keywordText = z
  .string()
  .trim()
  .min(1, "Informe a palavra-chave.")
  .max(80, "O Google aceita até 80 caracteres.")
  .refine((t) => t.split(/\s+/).length <= 10, "O Google aceita até 10 palavras.");

/** Conta do Google que a pessoa enxerga, com o token pronto. */
async function context(accountId: string, userId: string) {
  if (!(await withinRateLimit(`ads-google-edit:${userId}`, 120, 3600))) return { error: RATE_LIMIT_MESSAGE };
  const supabase = await createClient();
  const { data: acc } = await supabase.from("ad_accounts").select("id, organization_id, external_id, provider").eq("id", accountId).maybeSingle();
  if (!acc || acc.provider !== "google_ads") return { error: "Conta não encontrada." };
  const conn = await getConnection(acc.organization_id, "google_ads");
  const token = conn && conn.status === "ativa" ? await accessToken(conn).catch(() => null) : null;
  if (!token) return { error: "A conexão com o Google expirou. Reconecte em Anúncios → Contas." };
  return { acc, token };
}

function googleError(e: unknown) {
  const reason = (e as { reason?: string }).reason;
  if (reason === "DUPLICATE_RESOURCE" || reason === "DUPLICATE_KEYWORD") return "Essa palavra-chave já existe aí.";
  if (reason === "POLICY_VIOLATION" || reason === "POLICY_FINDING") return "O Google recusou o texto pelas políticas de anúncios.";
  if (reason === "USER_PERMISSION_DENIED") return "Seu e-mail do Google não tem permissão de edição nessa conta.";
  return "O Google não aceitou a mudança agora. Tente de novo em alguns minutos.";
}

async function audit(orgId: string, userId: string, accountId: string, changes: Record<string, unknown>) {
  await createAdminClient().from("audit_logs").insert({ organization_id: orgId, actor_id: userId, action: "ads_edit", entity_type: "google_keywords", entity_id: accountId, changes });
}

const refresh = () => revalidatePath("/anuncios/google");

export const setGoogleKeywordStatus = defineAction(
  { schema: z.object({ accountId: z.uuid(), adGroupId: id, criterionId: id, text: z.string().max(80), active: z.boolean() }), permission: "ads.manage" },
  async (input, { user }) => {
    const ctx = await context(input.accountId, user.id);
    if ("error" in ctx) return fail("business_rule", ctx.error!);
    const status = input.active ? "ENABLED" : "PAUSED";
    try {
      await googleAdsSetKeywordStatus(ctx.token, ctx.acc.external_id, input.adGroupId, input.criterionId, status);
    } catch (e) {
      return fail("network", googleError(e));
    }
    await audit(ctx.acc.organization_id, user.id, ctx.acc.id, { palavra: input.text, status });
    refresh();
    return ok(null, `“${input.text}” ${input.active ? "ativada" : "pausada"}.`);
  },
);

export const addGoogleKeyword = defineAction(
  { schema: z.object({ accountId: z.uuid(), adGroupId: id, text: keywordText, matchType }), permission: "ads.manage" },
  async (input, { user }) => {
    const ctx = await context(input.accountId, user.id);
    if ("error" in ctx) return fail("business_rule", ctx.error!);
    try {
      await googleAdsAddKeyword(ctx.token, ctx.acc.external_id, input.adGroupId, input.text, input.matchType);
    } catch (e) {
      return fail("network", googleError(e));
    }
    await audit(ctx.acc.organization_id, user.id, ctx.acc.id, { adicionada: input.text, correspondencia: input.matchType });
    refresh();
    return ok(null, `Palavra-chave “${input.text}” adicionada.`);
  },
);

export const addGoogleNegative = defineAction(
  { schema: z.object({ accountId: z.uuid(), campaignId: id, text: keywordText, matchType }), permission: "ads.manage" },
  async (input, { user }) => {
    const ctx = await context(input.accountId, user.id);
    if ("error" in ctx) return fail("business_rule", ctx.error!);
    try {
      await googleAdsAddNegative(ctx.token, ctx.acc.external_id, input.campaignId, input.text, input.matchType);
    } catch (e) {
      return fail("network", googleError(e));
    }
    await audit(ctx.acc.organization_id, user.id, ctx.acc.id, { negativada: input.text, correspondencia: input.matchType });
    refresh();
    return ok(null, `“${input.text}” negativada: o anúncio não aparece mais para essa pesquisa.`);
  },
);

/** Ideias do Planejador. Sem acesso Básico, devolve o aviso de aprovação pendente. */
export const getKeywordIdeas = defineAction(
  {
    schema: z
      .object({
        accountId: z.uuid(),
        keywords: z.array(z.string().trim().min(1).max(80)).max(10),
        url: z.string().trim().max(500).nullable(),
      })
      .refine((v) => v.keywords.length > 0 || (v.url && /^https?:\/\//.test(v.url)), { message: "Informe palavras ou um site começando com https://", path: ["keywords"] }),
    permission: "ads.read",
  },
  async (input, { user }) => {
    if (!(await withinRateLimit(`ads-ideas:${user.id}`, 30, 3600))) return fail("business_rule", RATE_LIMIT_MESSAGE);
    const supabase = await createClient();
    const { data: acc } = await supabase.from("ad_accounts").select("id, organization_id, external_id, provider").eq("id", input.accountId).maybeSingle();
    if (!acc || acc.provider !== "google_ads") return fail("forbidden", "Conta não encontrada.");
    const conn = await getConnection(acc.organization_id, "google_ads");
    const token = conn && conn.status === "ativa" ? await accessToken(conn).catch(() => null) : null;
    if (!token) return fail("business_rule", "A conexão com o Google expirou. Reconecte em Anúncios → Contas.");
    try {
      return ok({ ideas: await googleAdsKeywordIdeas(token, acc.external_id, { keywords: input.keywords, url: input.url || null }) });
    } catch (e) {
      const reason = (e as { reason?: string }).reason;
      if (reason === "DEVELOPER_TOKEN_NOT_APPROVED")
        return fail("business_rule", "O Planejador ainda não foi liberado: o Google está analisando o pedido de acesso Básico. Assim que aprovar, as ideias aparecem aqui, sem precisar mudar nada.");
      return fail("network", "O Google não respondeu agora. Tente de novo em alguns minutos.");
    }
  },
);
