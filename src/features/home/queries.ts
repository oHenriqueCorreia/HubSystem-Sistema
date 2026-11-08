import "server-only";
import { addDays, addMonths, format, startOfMonth, startOfWeek } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { zonedDay, zonedIso } from "@/domain/calendar";
import { todayLocal } from "@/domain/shared/dates";
import { DEFAULT_CITY, type City } from "@/domain/home";
import type { CurrentUser } from "@/lib/auth/dal";

export const HOME_WIDGETS = [
  { key: "agendas", label: "Todas as agendas" },
  { key: "clima", label: "Clima" },
  { key: "passagem", label: "Passagem bíblica e mensagem" },
  { key: "resumo", label: "Resumo das tarefas" },
  { key: "prioritarias", label: "Prioritárias e agendadas" },
  { key: "reunioes", label: "Reuniões" },
  { key: "comercial", label: "Comercial" },
  { key: "atendimento", label: "Atendimento (WhatsApp)" },
  { key: "anuncios", label: "Anúncios" },
  { key: "financeiro", label: "Financeiro" },
  { key: "alertas", label: "Alertas e integrações" },
  { key: "meu_dia", label: "Meu dia" },
] as const;
export type HomeWidget = (typeof HOME_WIDGETS)[number]["key"];

export type HomePrefs = { hidden: HomeWidget[]; order: HomeWidget[]; city: City };

export function homePrefs(user: CurrentUser): HomePrefs {
  const raw = (user.preferences.home ?? {}) as Partial<HomePrefs>;
  const keys = HOME_WIDGETS.map((w) => w.key) as HomeWidget[];
  const order = [...(raw.order ?? []).filter((k) => keys.includes(k)), ...keys.filter((k) => !(raw.order ?? []).includes(k))];
  const city = raw.city && Number.isFinite(raw.city.latitude) && Number.isFinite(raw.city.longitude) ? raw.city : DEFAULT_CITY;
  return { hidden: (raw.hidden ?? []).filter((k) => keys.includes(k)), order, city };
}

type Count = { count: number | null };
const n = (r: Count) => r.count ?? 0;

export type HomeTask = { id: string; title: string; due_at: string | null; priority: string; has_time: boolean };
export type HomeMeeting = { id: string; title: string; starts_at: string; meet_url: string | null };

export type HomeOverview = {
  tasks: { open: number; todo: number; doing: number; overdue: number; priority: number; scheduled: number; doneWeek: number } | null;
  priorityList: HomeTask[];
  scheduledList: HomeTask[];
  meetings: { week: number; month: number; next: HomeMeeting[] } | null;
  commercial: { attendedWeek: number; waiting: number; newLeadsWeek: number; openDeals: number; pipelineCents: number; wonMonth: number; wonMonthCents: number } | null;
  inbox: { open: number; waiting: number; unread: number; disconnected: number } | null;
  ads: {
    spendYesterday: number;
    spend7d: number;
    conversions7d: number;
    accounts: number;
    lowBalance: { id: string; name: string; balance_cents: number }[];
    connections: { provider: string; status: string }[];
    reportFailures: number;
  } | null;
  finance: {
    scope: "empresa" | "pessoal";
    receivable: number;
    payable: number;
    overdueReceivable: number;
    overduePayable: number;
    monthIn: number;
    monthOut: number;
    /** A pagar e a receber de hoje até 7 dias (inclui recorrências). */
    dueSoon: { id: string; kind: "receita" | "despesa"; description: string; amount_cents: number; due_date: string; recurrence_id: string | null }[];
  }[];
  google: { status: string; last_synced_at: string | null; last_error: string | null } | null;
  pendingInvites: number;
};

const sum = (rows: { amount_cents: number | null }[] | null) => (rows ?? []).reduce((a, r) => a + Number(r.amount_cents ?? 0), 0);

export async function getHomeOverview(user: CurrentUser): Promise<HomeOverview> {
  const supabase = await createClient();
  const p = user.permissions;
  const today = todayLocal();
  const nowIso = new Date().toISOString();
  const weekStart = format(startOfWeek(zonedDay(today), { weekStartsOn: 0 }), "yyyy-MM-dd");
  const weekStartIso = zonedIso(weekStart, "00:00");
  const weekEndIso = zonedIso(format(addDays(zonedDay(weekStart), 7), "yyyy-MM-dd"), "00:00");
  const monthStart = format(startOfMonth(zonedDay(today)), "yyyy-MM-dd");
  const monthEnd = format(addDays(addMonths(zonedDay(monthStart), 1), -1), "yyyy-MM-dd");
  const monthStartIso = zonedIso(monthStart, "00:00");
  const monthEndIso = zonedIso(format(addMonths(zonedDay(monthStart), 1), "yyyy-MM-dd"), "00:00");

  const mine = () => supabase.from("tasks").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("owner_id", user.id);
  const open = ["a_fazer", "em_andamento"];
  const taskCols = "id, title, due_at, priority, has_time";

  const tasksP = p["tasks.read"]
    ? Promise.all([
        mine().in("status", open),
        mine().eq("status", "a_fazer"),
        mine().eq("status", "em_andamento"),
        mine().in("status", open).lt("due_at", nowIso),
        mine().in("status", open).in("priority", ["alta", "urgente"]),
        mine().in("status", open).gte("due_at", nowIso),
        mine().eq("status", "concluida").gte("completed_at", weekStartIso),
        supabase
          .from("tasks")
          .select(taskCols)
          .is("deleted_at", null)
          .eq("owner_id", user.id)
          .in("status", open)
          .in("priority", ["urgente", "alta"])
          .order("priority", { ascending: false })
          .order("due_at", { nullsFirst: false })
          .limit(5),
        supabase.from("tasks").select(taskCols).is("deleted_at", null).eq("owner_id", user.id).in("status", open).gte("due_at", nowIso).order("due_at").limit(5),
      ])
    : null;

  const meetingsBase = () =>
    supabase.from("calendar_events").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("owner_id", user.id).eq("kind", "reuniao");
  const meetingsP = p["calendar.read"]
    ? Promise.all([
        meetingsBase().gte("starts_at", weekStartIso).lt("starts_at", weekEndIso),
        meetingsBase().gte("starts_at", monthStartIso).lt("starts_at", monthEndIso),
        supabase
          .from("calendar_events")
          .select("id, title, starts_at, meet_url")
          .is("deleted_at", null)
          .eq("owner_id", user.id)
          .eq("kind", "reuniao")
          .gte("ends_at", nowIso)
          .lt("starts_at", weekEndIso)
          .order("starts_at")
          .limit(5),
      ])
    : null;

  const commercialP = p["crm.leads.read"]
    ? Promise.all([
        supabase
          .from("activities")
          .select("lead_id", { count: "exact", head: true })
          .eq("created_by", user.id)
          .in("type", ["whatsapp", "ligacao", "email", "reuniao"])
          .gte("occurred_at", weekStartIso),
        supabase.from("leads").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("owner_id", user.id).lt("next_contact_at", nowIso),
        supabase.from("leads").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("owner_id", user.id).gte("created_at", weekStartIso),
        // Funil: negócios em aberto (valor em negociação) e ganhos no mês.
        supabase.from("deals").select("amount_cents, stage:stages!inner(kind)").is("won_at", null).is("lost_at", null).eq("stage.kind", "open").limit(5000),
        supabase.from("deals").select("amount_cents").gte("won_at", monthStartIso).limit(5000),
      ])
    : null;

  // Atendimento: conversas abertas, esperando resposta, mensagens não lidas e números desconectados.
  const inboxP = p["inbox.read"]
    ? Promise.all([
        supabase.from("conversations").select("id", { count: "exact", head: true }).is("excluded_at", null).eq("status", "aberta"),
        supabase.from("conversations").select("id", { count: "exact", head: true }).is("excluded_at", null).eq("status", "aberta").eq("waiting_reply", true),
        supabase.from("conversations").select("unread_count").is("excluded_at", null).gt("unread_count", 0).limit(2000),
        supabase.rpc("my_whatsapp_numbers"),
      ])
    : null;

  // Anúncios: investimento de ontem e dos últimos 7 dias, saldo abaixo do alerta, conexões e envios que falharam.
  const yesterday = format(addDays(zonedDay(today), -1), "yyyy-MM-dd");
  const weekAgo = format(addDays(zonedDay(today), -7), "yyyy-MM-dd");
  const adsP = p["ads.read"]
    ? (async () => {
        const { data: accounts } = await supabase.from("ad_accounts").select("id, name, balance_cents, alert_balance_below_cents").eq("is_selected", true);
        const ids = (accounts ?? []).map((a) => a.id as string);
        const [week, day, conns, failures] = await Promise.all([
          ids.length ? supabase.rpc("ad_report_accounts", { p_accounts: ids, p_from: weekAgo, p_to: yesterday }) : Promise.resolve({ data: [] }),
          ids.length ? supabase.rpc("ad_report_accounts", { p_accounts: ids, p_from: yesterday, p_to: yesterday }) : Promise.resolve({ data: [] }),
          supabase.rpc("my_ad_connections"),
          supabase.from("ads_report_log").select("id", { count: "exact", head: true }).eq("status", "falhou").gte("sent_at", new Date(Date.now() - 86_400_000).toISOString()),
        ]);
        const total = (rows: unknown, k: "spend_cents" | "conversions") => ((rows ?? []) as Record<string, number>[]).reduce((a, r) => a + Number(r[k] ?? 0), 0);
        return {
          spendYesterday: total(day.data, "spend_cents"),
          spend7d: total(week.data, "spend_cents"),
          conversions7d: Math.round(total(week.data, "conversions")),
          accounts: ids.length,
          lowBalance: ((accounts ?? []) as { id: string; name: string; balance_cents: number | null; alert_balance_below_cents: number | null }[])
            .filter((a) => a.alert_balance_below_cents != null && a.balance_cents != null && a.balance_cents < a.alert_balance_below_cents)
            .map((a) => ({ id: a.id, name: a.name, balance_cents: Number(a.balance_cents) })),
          connections: ((conns.data ?? []) as { provider: string; status: string }[]).map((c) => ({ provider: c.provider, status: c.status })),
          reportFailures: (failures as Count).count ?? 0,
        };
      })()
    : null;

  // Financeiro: contas a receber/pagar previstas até o fim do mês (e vencidas).
  const scopes: ("empresa" | "pessoal")[] = [];
  if (p["finance.company.read"]) scopes.push("empresa");
  if (p["finance.personal.manage"]) scopes.push("pessoal");
  const financeP = Promise.all(
    scopes.map(async (scope) => {
      const base = (kind: "receita" | "despesa") =>
        supabase.from("financial_transactions").select("amount_cents").is("deleted_at", null).eq("scope", scope).eq("kind", kind).eq("status", "previsto").limit(5000);
      const paid = (kind: "receita" | "despesa") =>
        supabase.from("financial_transactions").select("amount_cents:paid_amount_cents").is("deleted_at", null).eq("scope", scope).eq("kind", kind).eq("status", "pago").gte("paid_at", monthStart).lte("paid_at", monthEnd).limit(5000);
      const weekAhead = new Date(Date.parse(`${today}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
      const [rec, pay, recLate, payLate, inPaid, outPaid, soon] = await Promise.all([
        base("receita").lte("due_date", monthEnd),
        base("despesa").lte("due_date", monthEnd),
        base("receita").lt("due_date", today),
        base("despesa").lt("due_date", today),
        paid("receita"),
        paid("despesa"),
        supabase
          .from("financial_transactions")
          .select("id, kind, description, amount_cents, due_date, recurrence_id")
          .is("deleted_at", null)
          .eq("scope", scope)
          .in("kind", ["despesa", "receita"])
          .eq("status", "previsto")
          .gte("due_date", today)
          .lte("due_date", weekAhead)
          .order("due_date")
          .limit(16),
      ]);
      return {
        scope,
        receivable: sum(rec.data),
        payable: sum(pay.data),
        overdueReceivable: sum(recLate.data),
        overduePayable: sum(payLate.data),
        monthIn: sum(inPaid.data as { amount_cents: number }[] | null),
        monthOut: sum(outPaid.data as { amount_cents: number }[] | null),
        dueSoon: (soon.data ?? []) as { id: string; kind: "receita" | "despesa"; description: string; amount_cents: number; due_date: string; recurrence_id: string | null }[],
      };
    }),
  );

  const [tasks, meetings, commercial, inbox, ads, finance, google, invites] = await Promise.all([
    tasksP,
    meetingsP,
    commercialP,
    inboxP,
    adsP,
    financeP,
    supabase.rpc("my_google_connection"),
    p["admin.users"]
      ? supabase.from("invitations").select("id", { count: "exact", head: true }).eq("status", "pendente").gt("expires_at", nowIso)
      : Promise.resolve({ count: 0 } as Count),
  ]);

  const g = google.data ? ((Array.isArray(google.data) ? google.data[0] : google.data) as HomeOverview["google"]) : null;

  return {
    tasks: tasks
      ? {
          open: n(tasks[0]),
          todo: n(tasks[1]),
          doing: n(tasks[2]),
          overdue: n(tasks[3]),
          priority: n(tasks[4]),
          scheduled: n(tasks[5]),
          doneWeek: n(tasks[6]),
        }
      : null,
    priorityList: (tasks?.[7].data ?? []) as HomeTask[],
    scheduledList: (tasks?.[8].data ?? []) as HomeTask[],
    meetings: meetings ? { week: n(meetings[0]), month: n(meetings[1]), next: (meetings[2].data ?? []) as HomeMeeting[] } : null,
    commercial: commercial
      ? {
          attendedWeek: n(commercial[0]),
          waiting: n(commercial[1]),
          newLeadsWeek: n(commercial[2]),
          openDeals: (commercial[3].data ?? []).length,
          pipelineCents: sum(commercial[3].data as { amount_cents: number }[] | null),
          wonMonth: (commercial[4].data ?? []).length,
          wonMonthCents: sum(commercial[4].data as { amount_cents: number }[] | null),
        }
      : null,
    inbox: inbox
      ? {
          open: n(inbox[0]),
          waiting: n(inbox[1]),
          unread: ((inbox[2].data ?? []) as { unread_count: number }[]).reduce((a, r) => a + r.unread_count, 0),
          disconnected: ((inbox[3].data ?? []) as { status: string }[]).filter((x) => x.status !== "ativo").length,
        }
      : null,
    ads,
    finance,
    google: g ?? null,
    pendingInvites: n(invites as Count),
  };
}
