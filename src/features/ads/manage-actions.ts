"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok } from "@/domain/shared/result";
import { formatBRL } from "@/domain/shared/money";
import { metaDuplicate, metaUpdate } from "@/lib/ads/meta";
import { googleAdsRenameCampaign, googleAdsSetCampaignBudget, googleAdsSetStatus } from "@/lib/ads/google-ads";
import { accessToken, getConnection, type AdProvider } from "@/lib/ads/tokens";
import { syncAds } from "@/lib/ads/sync";
import { RATE_LIMIT_MESSAGE, withinRateLimit } from "@/lib/rate-limit";

// Edição de campanhas, conjuntos/grupos e anúncios direto na Meta e no Google.
// A linha é lida com o acesso da pessoa (RLS): só edita o que ela enxerga.

const level = z.enum(["campaign", "adset", "ad"]);
type Level = z.infer<typeof level>;
const TABLE: Record<Level, "ad_campaigns" | "ad_sets" | "ads"> = { campaign: "ad_campaigns", adset: "ad_sets", ad: "ads" };
const NOUN: Record<Level, string> = { campaign: "Campanha", adset: "Conjunto", ad: "Anúncio" };

async function load(lvl: Level, id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from(TABLE[lvl])
    .select("id, organization_id, external_id, name, status, account_id, ad_accounts(provider, external_id)" + (lvl === "ad" ? "" : ", daily_budget_cents"))
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as {
    id: string;
    organization_id: string;
    external_id: string;
    name: string;
    status: string | null;
    daily_budget_cents?: number | null;
    ad_accounts: { provider: AdProvider; external_id: string } | { provider: AdProvider; external_id: string }[];
  };
  const account = Array.isArray(row.ad_accounts) ? row.ad_accounts[0] : row.ad_accounts;
  const conn = await getConnection(row.organization_id, account.provider);
  if (!conn || conn.status !== "ativa") return { row, account, token: null };
  return { row, account, token: await accessToken(conn).catch(() => null) };
}

/** Mensagem clara a partir do erro da plataforma. */
function platformError(e: unknown) {
  const err = e as { userMessage?: string; code?: number; reason?: string; status?: number };
  if (err.code === 200 || err.code === 10) return "A Meta não deu permissão para editar. Reconecte a Meta em Anúncios → Contas aceitando “gerenciar anúncios”.";
  if (err.reason === "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION") return "O Google ainda não liberou a edição: peça o acesso Explorer da Google Ads API no Google Cloud.";
  if (err.userMessage) return `A plataforma recusou: ${err.userMessage}`;
  return "A plataforma não aceitou a mudança agora. Tente de novo em alguns minutos.";
}

async function audit(organizationId: string, actorId: string, lvl: Level, id: string, changes: Record<string, { de: unknown; para: unknown }>) {
  await createAdminClient().from("audit_logs").insert({ organization_id: organizationId, actor_id: actorId, action: "ads_edit", entity_type: TABLE[lvl], entity_id: id, changes });
}

const refresh = () => revalidatePath("/anuncios", "layout");

export const setAdStatus = defineAction({ schema: z.object({ level, id: z.uuid(), active: z.boolean() }), permission: "ads.manage" }, async (input, { user }) => {
  if (!(await withinRateLimit(`ads-edit:${user.id}`, 120, 3600))) return fail("business_rule", RATE_LIMIT_MESSAGE);
  const ctx = await load(input.level, input.id);
  if (!ctx) return fail("forbidden", "Item não encontrado.");
  if (!ctx.token) return fail("business_rule", "A conexão com a plataforma expirou. Reconecte em Anúncios → Contas.");
  const meta = ctx.account.provider === "meta_ads";
  const status = input.active ? (meta ? "ACTIVE" : "ENABLED") : "PAUSED";
  try {
    if (meta) await metaUpdate(ctx.token, ctx.row.external_id, { status: status as "ACTIVE" | "PAUSED" });
    else await googleAdsSetStatus(ctx.token, ctx.account.external_id, input.level, ctx.row.external_id, status as "ENABLED" | "PAUSED");
  } catch (e) {
    return fail("network", platformError(e));
  }
  await createAdminClient().from(TABLE[input.level]).update({ status }).eq("id", ctx.row.id);
  await audit(ctx.row.organization_id, user.id, input.level, ctx.row.id, { status: { de: ctx.row.status, para: status } });
  refresh();
  return ok(null, `${NOUN[input.level]} ${input.active ? "ativado(a)" : "pausado(a)"}: ${ctx.row.name}.`);
});

export const setAdBudget = defineAction(
  { schema: z.object({ level: z.enum(["campaign", "adset"]), id: z.uuid(), dailyBudgetCents: z.number().int().min(100, "O orçamento mínimo é R$ 1,00.").max(100_000_000) }),
    permission: "ads.manage" },
  async (input, { user }) => {
    if (!(await withinRateLimit(`ads-edit:${user.id}`, 120, 3600))) return fail("business_rule", RATE_LIMIT_MESSAGE);
    const ctx = await load(input.level, input.id);
    if (!ctx) return fail("forbidden", "Item não encontrado.");
    if (!ctx.token) return fail("business_rule", "A conexão com a plataforma expirou. Reconecte em Anúncios → Contas.");
    try {
      if (ctx.account.provider === "meta_ads") await metaUpdate(ctx.token, ctx.row.external_id, { dailyBudgetCents: input.dailyBudgetCents });
      else if (input.level === "campaign") await googleAdsSetCampaignBudget(ctx.token, ctx.account.external_id, ctx.row.external_id, input.dailyBudgetCents);
      else return fail("business_rule", "No Google, o orçamento fica na campanha.");
    } catch (e) {
      return fail("network", platformError(e));
    }
    await createAdminClient().from(TABLE[input.level]).update({ daily_budget_cents: input.dailyBudgetCents }).eq("id", ctx.row.id);
    await audit(ctx.row.organization_id, user.id, input.level, ctx.row.id, { daily_budget_cents: { de: ctx.row.daily_budget_cents ?? null, para: input.dailyBudgetCents } });
    refresh();
    return ok(null, `Orçamento diário de ${ctx.row.name}: ${formatBRL(input.dailyBudgetCents)}.`);
  },
);

export const renameAdEntity = defineAction(
  { schema: z.object({ level, id: z.uuid(), name: z.string().trim().min(1, "Informe o nome.").max(250) }), permission: "ads.manage" },
  async (input, { user }) => {
    if (!(await withinRateLimit(`ads-edit:${user.id}`, 120, 3600))) return fail("business_rule", RATE_LIMIT_MESSAGE);
    const ctx = await load(input.level, input.id);
    if (!ctx) return fail("forbidden", "Item não encontrado.");
    if (!ctx.token) return fail("business_rule", "A conexão com a plataforma expirou. Reconecte em Anúncios → Contas.");
    try {
      if (ctx.account.provider === "meta_ads") await metaUpdate(ctx.token, ctx.row.external_id, { name: input.name });
      else if (input.level === "campaign") await googleAdsRenameCampaign(ctx.token, ctx.account.external_id, ctx.row.external_id, input.name);
      else return fail("business_rule", "No Google, renomeie grupos e anúncios pelo próprio Google Ads.");
    } catch (e) {
      return fail("network", platformError(e));
    }
    await createAdminClient().from(TABLE[input.level]).update({ name: input.name }).eq("id", ctx.row.id);
    await audit(ctx.row.organization_id, user.id, input.level, ctx.row.id, { name: { de: ctx.row.name, para: input.name } });
    refresh();
    return ok(null, "Nome atualizado.");
  },
);

export const duplicateAdEntity = defineAction({ schema: z.object({ level: z.enum(["campaign", "adset"]), id: z.uuid() }), permission: "ads.manage" }, async (input, { user }) => {
  if (!(await withinRateLimit(`ads-edit:${user.id}`, 30, 3600))) return fail("business_rule", RATE_LIMIT_MESSAGE);
  const ctx = await load(input.level, input.id);
  if (!ctx) return fail("forbidden", "Item não encontrado.");
  if (ctx.account.provider !== "meta_ads") return fail("business_rule", "Duplicar está disponível para a Meta.");
  if (!ctx.token) return fail("business_rule", "A conexão com a plataforma expirou. Reconecte em Anúncios → Contas.");
  try {
    await metaDuplicate(ctx.token, input.level, ctx.row.external_id);
  } catch (e) {
    return fail("network", platformError(e));
  }
  await audit(ctx.row.organization_id, user.id, input.level, ctx.row.id, { duplicado: { de: null, para: ctx.row.name } });
  // Traz a cópia para o sistema.
  await syncAds(user.organizationId, "meta_ads").catch(() => null);
  refresh();
  return ok(null, `${NOUN[input.level]} duplicado(a), pausado(a) para você revisar.`);
});
