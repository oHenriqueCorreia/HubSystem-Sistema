"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { fail, ok } from "@/domain/shared/result";
import { listGroups, sendReportNow, sendTest } from "@/lib/ads/reports";
import { RATE_LIMIT_MESSAGE, withinRateLimit } from "@/lib/rate-limit";

const refresh = () => revalidatePath("/relatorios");

const SEND_ERRORS: Record<string, string> = {
  sem_destino: "Escolha o WhatsApp e o grupo antes de enviar.",
  repetido: "Esta mensagem já foi enviada.",
};

/** Grupos de que o WhatsApp escolhido participa. */
export const loadReportGroups = defineAction({ schema: z.object({ numberId: z.uuid() }), permission: "ads.manage" }, async (input, { user }) => {
  if (!(await withinRateLimit(`ads-groups:${user.organizationId}`, 30, 600))) return fail("business_rule", RATE_LIMIT_MESSAGE);
  try {
    const groups = await listGroups(user.organizationId, input.numberId);
    if (!groups) return fail("business_rule", "Este WhatsApp não está conectado por QR Code. Conecte em Comercial → Atendimento.");
    return ok(groups);
  } catch {
    return fail("network", "Não foi possível falar com o servidor do WhatsApp. Confira se ele está ligado.");
  }
});

export const saveReportSettings = defineAction(
  {
    schema: z.object({
      numberId: z.uuid().nullable(),
      groupId: z
        .string()
        .regex(/^[0-9A-Za-z.:_-]{3,80}@g\.us$/, "Escolha um grupo da lista.")
        .nullable(),
      alertsEnabled: z.boolean(),
      dailyEnabled: z.boolean(),
      weeklyEnabled: z.boolean(),
    }),
    permission: "ads.manage",
  },
  async (input, { user }) => {
    let groupName: string | null = null;
    if (input.groupId) {
      if (!input.numberId) return fail("validation", "Escolha o WhatsApp que envia as mensagens.");
      // O grupo precisa existir neste WhatsApp: o nome vem do próprio WhatsApp, não da tela.
      const groups = await listGroups(user.organizationId, input.numberId).catch(() => null);
      const g = groups?.find((x) => x.id === input.groupId);
      if (!g) return fail("business_rule", "Este grupo não foi encontrado no WhatsApp escolhido. Atualize a lista e tente de novo.");
      groupName = g.name.slice(0, 200);
    }
    const supabase = await createClient();
    must(
      await supabase.from("ads_report_settings").upsert(
        {
          organization_id: user.organizationId,
          whatsapp_number_id: input.numberId,
          group_id: input.groupId,
          group_name: groupName,
          alerts_enabled: input.alertsEnabled,
          daily_enabled: input.dailyEnabled,
          weekly_enabled: input.weeklyEnabled,
          updated_by: user.id,
        },
        { onConflict: "organization_id" },
      ),
    );
    refresh();
    return ok(null, "Configuração salva.");
  },
);

export const sendReportTest = defineAction({ schema: z.object({}), permission: "ads.manage" }, async (_input, { user }) => {
  if (!(await withinRateLimit(`ads-report-send:${user.organizationId}`, 10, 3600))) return fail("business_rule", RATE_LIMIT_MESSAGE);
  const r = await sendTest(user.organizationId);
  refresh();
  if (r.sent) return ok(null, "Mensagem de teste enviada ao grupo.");
  return fail("network", r.reason === "falhou" ? r.error : SEND_ERRORS[r.reason]);
});

export const sendReportManual = defineAction({ schema: z.object({ kind: z.enum(["diario", "semanal"]) }), permission: "ads.manage" }, async (input, { user }) => {
  if (!(await withinRateLimit(`ads-report-send:${user.organizationId}`, 10, 3600))) return fail("business_rule", RATE_LIMIT_MESSAGE);
  const r = await sendReportNow(user.organizationId, input.kind);
  refresh();
  if (r.sent) return ok(null, input.kind === "diario" ? "Relatório de ontem enviado ao grupo." : "Resumo da semana enviado ao grupo.");
  return fail("network", r.reason === "falhou" ? r.error : SEND_ERRORS[r.reason]);
});

const cents = z.number().int().min(0).max(100_000_000_000).nullable();

export const saveAccountAlerts = defineAction(
  { schema: z.object({ id: z.uuid(), balanceBelowCents: cents, dailySpendAboveCents: cents, noSpend: z.boolean() }), permission: "ads.manage" },
  async (input) => {
    const supabase = await createClient();
    const res = must(
      await supabase
        .from("ad_accounts")
        .update({ alert_balance_below_cents: input.balanceBelowCents, alert_daily_spend_above_cents: input.dailySpendAboveCents, alert_no_spend: input.noSpend })
        .eq("id", input.id)
        .select("id"),
    ) as { id: string }[];
    if (!res.length) return fail("forbidden", "Conta não encontrada.");
    refresh();
    revalidatePath("/anuncios", "layout");
    return ok(null, "Alertas salvos.");
  },
);
