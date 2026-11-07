import { formatBRL } from "@/domain/shared/money";

// Textos enviados ao grupo do WhatsApp. *negrito* e _itálico_ são a marcação do próprio WhatsApp.

export type AccountTotals = {
  name: string;
  provider: "meta_ads" | "google_ads";
  client: string | null;
  spendCents: number;
  impressions: number;
  clicks: number;
  conversions: number;
};

export type AccountPeriod = AccountTotals & { previous?: Omit<AccountTotals, "name" | "provider" | "client"> | null };

const PLATFORM = { meta_ads: "Meta", google_ads: "Google" } as const;
const int = (v: number) => Math.round(v).toLocaleString("pt-BR");
const ddmm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** "+12%", "−8%", "novo" ou "" quando não há comparação útil. */
export function variation(now: number, before: number | undefined | null) {
  if (before == null) return "";
  if (before === 0) return now > 0 ? "novo" : "";
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return "estável";
  return pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
}

function line(a: AccountPeriod) {
  const parts = [`${formatBRL(a.spendCents)}`, `${int(a.impressions)} impressões`, `${int(a.clicks)} cliques`];
  if (a.conversions > 0) parts.push(`${int(a.conversions)} conversões (${formatBRL(Math.round(a.spendCents / a.conversions))} cada)`);
  const head = `• ${a.name} _(${PLATFORM[a.provider]})_`;
  const diff = a.previous ? variation(a.spendCents, a.previous.spendCents) : "";
  return `${head}\n  ${parts.join(" · ")}${diff ? `\n  Gasto vs. semana anterior: ${diff}` : ""}`;
}

/** Agrupa por cliente (contas sem cliente por último), cada grupo em ordem de gasto. */
function grouped(accounts: AccountPeriod[]) {
  const groups = new Map<string, AccountPeriod[]>();
  for (const a of [...accounts].sort((x, y) => y.spendCents - x.spendCents)) {
    const k = a.client ?? "";
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  return [...groups.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "pt-BR")));
}

function totals(accounts: AccountTotals[]) {
  const spend = accounts.reduce((s, a) => s + a.spendCents, 0);
  const conv = accounts.reduce((s, a) => s + a.conversions, 0);
  const clicks = accounts.reduce((s, a) => s + a.clicks, 0);
  return { spend, conv, clicks };
}

/** Contas sem gasto e sem impressões viram uma linha só no fim: o foco fica no que rodou. */
function body(accounts: AccountPeriod[]) {
  const idle = (a: AccountPeriod) => a.spendCents === 0 && a.impressions === 0;
  const running = accounts.filter((a) => !idle(a));
  const stopped = accounts.filter(idle).map((a) => a.name).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const blocks = grouped(running).map(([client, list]) => `*${client || "Sem cliente"}*\n${list.map(line).join("\n")}`);
  if (stopped.length) blocks.push(`_Sem gasto no período:_ ${stopped.join(", ")}`);
  return blocks.join("\n\n");
}

export function dailyReport(day: string, accounts: AccountPeriod[]) {
  const title = `Relatório de anúncios · ${ddmm(day)}`;
  if (!accounts.length) return { title, text: `📊 *${title}*\n\nNenhuma conta ativa nos relatórios.` };
  const t = totals(accounts);
  const total = `*Total do dia:* ${formatBRL(t.spend)} · ${int(t.clicks)} cliques${t.conv > 0 ? ` · ${int(t.conv)} conversões` : ""}`;
  return { title, text: `📊 *${title}*\n\n${body(accounts)}\n\n${total}` };
}

export function weeklyReport(from: string, to: string, accounts: AccountPeriod[]) {
  const title = `Resumo semanal de anúncios · ${ddmm(from)} a ${ddmm(to)}`;
  if (!accounts.length) return { title, text: `📈 *${title}*\n\nNenhuma conta ativa nos relatórios.` };
  const t = totals(accounts);
  const before = accounts.reduce((s, a) => s + (a.previous?.spendCents ?? 0), 0);
  const diff = variation(t.spend, accounts.some((a) => a.previous) ? before : null);
  const total = `*Total da semana:* ${formatBRL(t.spend)}${diff ? ` (${diff} vs. semana anterior)` : ""} · ${int(t.clicks)} cliques${t.conv > 0 ? ` · ${int(t.conv)} conversões` : ""}`;
  return { title, text: `📈 *${title}*\n\n${body(accounts)}\n\n${total}` };
}

export type AlertItem = { title: string; detail: string };

export function alertsMessage(items: AlertItem[]) {
  const title = items.length === 1 ? items[0].title : `${items.length} alertas de anúncios`;
  const text = `⚠️ *${items.length === 1 ? "Alerta de anúncios" : title}*\n\n${items.map((i) => `• *${i.title}*\n  ${i.detail}`).join("\n")}`;
  return { title, text };
}

export function testMessage(groupName: string, accounts: number) {
  return {
    title: "Mensagem de teste",
    text: `✅ *Hub System conectado*\n\nEste grupo (${groupName}) vai receber os alertas e relatórios das contas de anúncio.\nContas acompanhadas agora: ${accounts}.`,
  };
}
