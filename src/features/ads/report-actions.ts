"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, must } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { fail, ok } from "@/domain/shared/result";
import { DEFAULT_TEMPLATES, unknownVariables, type TemplateKey } from "@/domain/ads/report-message";
import { listGroups, sendReportNow, sendTest } from "@/lib/ads/reports";
import { RATE_LIMIT_MESSAGE, withinRateLimit } from "@/lib/rate-limit";

const refresh = () => revalidatePath("/relatorios");

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
      monthlyEnabled: z.boolean(),
      monthlyDay: z.number().int().min(1).max(28),
      sendTime: z.string().regex(/^([01]\d|2[0-3]):(00|15|30|45)$/, "Escolha um horário da lista."),
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
          monthly_enabled: input.monthlyEnabled,
          monthly_day: input.monthlyDay,
          send_time: input.sendTime,
          updated_by: user.id,
        },
        { onConflict: "organization_id" },
      ),
    );
    refresh();
    return ok(null, "Configuração salva.");
  },
);

const templateKey = z.enum(Object.keys(DEFAULT_TEMPLATES) as [TemplateKey, ...TemplateKey[]]);

/** text null = volta ao modelo padrão. */
export const saveReportTemplate = defineAction(
  { schema: z.object({ key: templateKey, text: z.string().max(2000, "O modelo pode ter até 2.000 caracteres.").nullable() }), permission: "ads.manage" },
  async (input, { user }) => {
    const text = input.text?.trim() || null;
    if (text) {
      const unknown = unknownVariables(input.key, text);
      if (unknown.length) return fail("validation", `Variável que não existe nesta mensagem: ${unknown.map((u) => `{${u}}`).join(", ")}. Use as da lista.`);
    }
    const supabase = await createClient();
    const { data: current } = await supabase.from("ads_report_settings").select("templates").maybeSingle();
    const templates = { ...((current?.templates as Record<string, string> | null) ?? {}) };
    if (text && text !== DEFAULT_TEMPLATES[input.key]) templates[input.key] = text;
    else delete templates[input.key];
    must(await supabase.from("ads_report_settings").upsert({ organization_id: user.organizationId, templates, updated_by: user.id }, { onConflict: "organization_id" }));
    refresh();
    return ok(null, text ? "Modelo salvo." : "Modelo padrão restaurado.");
  },
);

export const sendReportTest = defineAction({ schema: z.object({}), permission: "ads.manage" }, async (_input, { user }) => {
  if (!(await withinRateLimit(`ads-report-send:${user.organizationId}`, 10, 3600))) return fail("business_rule", RATE_LIMIT_MESSAGE);
  const r = await sendTest(user.organizationId);
  refresh();
  if (r.sent) return ok(null, "Mensagem de teste enviada ao grupo.");
  return fail("network", r.reason === "falhou" ? r.error : r.reason === "sem_destino" ? "Escolha o WhatsApp e o grupo antes de enviar." : "Esta mensagem já foi enviada.");
});

const KIND_LABEL = { diario: "Relatório diário", semanal: "Relatório semanal", mensal: "Relatório mensal" } as const;

export const sendReportManual = defineAction({ schema: z.object({ kind: z.enum(["diario", "semanal", "mensal"]) }), permission: "ads.manage" }, async (input, { user }) => {
  if (!(await withinRateLimit(`ads-report-send:${user.organizationId}`, 10, 3600))) return fail("business_rule", RATE_LIMIT_MESSAGE);
  const r = await sendReportNow(user.organizationId, input.kind);
  refresh();
  if (!r.total && r.failed) return fail("business_rule", r.failed);
  if (!r.total) return fail("business_rule", "Nenhuma conta está nos relatórios. Ative as contas em Anúncios → Contas.");
  if (r.sent === r.total) return ok(null, `${KIND_LABEL[input.kind]} enviado: ${r.sent} cliente(s).`);
  return fail("network", `${r.sent} de ${r.total} mensagens enviadas. ${r.failed ?? ""}`.trim());
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
