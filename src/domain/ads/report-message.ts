import { formatBRL } from "@/domain/shared/money";

// Mensagens enviadas ao grupo do WhatsApp, montadas a partir de modelos editáveis.
// *negrito* e _itálico_ são a marcação do próprio WhatsApp.

export type TemplateKey = "semanal" | "mensal" | "diario" | "alerta_saldo" | "alerta_gasto" | "alerta_parado" | "alerta_conexao";
export type Templates = Partial<Record<TemplateKey, string>>;

export const DEFAULT_TEMPLATES: Record<TemplateKey, string> = {
  semanal: `📊 Relatório Semanal - {cliente}
🔷 {plataformas}

📅 Período: {inicio} - {fim}

💰 Investimento: {investimento}
👁️ Impressões: {impressoes}
👆 Cliques: {cliques}
🎯 Resultados: {resultados}
💵 Custo por Resultado: {custo_por_resultado}`,
  mensal: `📊 RELATÓRIO Mensal - {cliente}
📅 Período: {inicio} - {fim}

📌 RESUMO GERAL
* Investimento: {investimento}
* Conversões: {resultados}
* Custo / Conv. (CPA): {custo_por_resultado}
* Cliques: {cliques}
* CPC Médio: {cpc}
* Impressões: {impressoes}
* CTR: {ctr}`,
  diario: `📊 Relatório Diário - {cliente}
🔷 {plataformas}
📅 {inicio}

💰 Investimento: {investimento}
👆 Cliques: {cliques}
🎯 Resultados: {resultados}
💵 Custo por Resultado: {custo_por_resultado}`,
  alerta_saldo: `🚨 ALERTA DE SALDO BAIXO

📊 Conta {plataforma}: {conta}
📌 Status: {status} | {pagamento}
💰 Saldo disponível: {saldo}

➡️ Alerta enviado porque o saldo da conta {plataforma_curta} está abaixo de {limite}

⚠️ Recarregue suas contas para manter suas campanhas ativas!`,
  alerta_gasto: `🚨 ALERTA DE GASTO

📊 Conta {plataforma}: {conta}
💸 Gasto de hoje: {gasto_hoje}

➡️ Alerta enviado porque o gasto do dia passou de {limite}

⚠️ Confira os orçamentos das campanhas.`,
  alerta_parado: `⏸️ CONTA SEM VEICULAR

📊 Conta {plataforma}: {conta}
📌 Status: {status}
📅 Sem nenhum gasto em {dia}

⚠️ Confira o pagamento e se as campanhas estão ativas.`,
  alerta_conexao: `🔌 CONEXÃO EXPIRADA

O acesso ao {plataforma} expirou. Os relatórios e alertas dessas contas param até reconectar em Anúncios → Contas.`,
};

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  semanal: "Relatório semanal",
  mensal: "Relatório mensal",
  diario: "Relatório diário",
  alerta_saldo: "Alerta de saldo baixo",
  alerta_gasto: "Alerta de gasto do dia",
  alerta_parado: "Alerta de conta parada",
  alerta_conexao: "Alerta de conexão expirada",
};

const REPORT_VARS = {
  cliente: "Nome do cliente (ou da conta, se não tiver cliente)",
  plataformas: "Meta Ads, Google Ads ou as duas",
  inicio: "Primeiro dia do período",
  fim: "Último dia do período",
  investimento: "Valor investido",
  impressoes: "Impressões",
  alcance: "Pessoas alcançadas (Meta)",
  cliques: "Cliques",
  resultados: "Resultados / conversões",
  custo_por_resultado: "Investimento ÷ resultados",
  cpc: "Custo por clique médio",
  ctr: "Cliques ÷ impressões",
  cpm: "Custo por mil impressões",
} as const;

const ACCOUNT_VARS = {
  conta: "Nome da conta de anúncio",
  cliente: "Nome do cliente",
  plataforma: "Meta Ads ou Google Ads",
  plataforma_curta: "Meta ou Google",
  status: "Situação da conta (Ativa, Desativada…)",
} as const;

export const TEMPLATE_VARIABLES: Record<TemplateKey, Record<string, string>> = {
  semanal: REPORT_VARS,
  mensal: REPORT_VARS,
  diario: REPORT_VARS,
  alerta_saldo: { ...ACCOUNT_VARS, pagamento: "Pré-paga ou Pós-paga", saldo: "Saldo disponível", limite: "Valor do alerta" },
  alerta_gasto: { ...ACCOUNT_VARS, gasto_hoje: "Gasto de hoje", limite: "Valor do alerta" },
  alerta_parado: { ...ACCOUNT_VARS, dia: "Dia sem gasto" },
  alerta_conexao: { plataforma: "Meta Ads ou Google Ads" },
};

export const templateFor = (key: TemplateKey, custom?: Templates | null) => (custom?.[key]?.trim() ? custom[key]! : DEFAULT_TEMPLATES[key]);

/** Troca {variável} pelo valor; variáveis desconhecidas ficam como estão, para a pessoa ver o erro. */
export function render(template: string, vars: Record<string, string>) {
  return template.replace(/\{([a-z_]+)\}/g, (all, k: string) => (k in vars ? vars[k] : all)).trim();
}

/** Variáveis do modelo que não existem para este tipo de mensagem. */
export function unknownVariables(key: TemplateKey, template: string) {
  const known = TEMPLATE_VARIABLES[key];
  return [...new Set([...template.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]))].filter((k) => !(k in known));
}

// ----------------------------------------------------------------------------
// Relatórios por cliente

export type Platform = "meta_ads" | "google_ads";
export type Metrics = { spendCents: number; impressions: number; reach: number; clicks: number; conversions: number };
export type ClientPeriod = Metrics & { client: string; platforms: Platform[] };

export const PLATFORM_NAME: Record<Platform, string> = { meta_ads: "Meta Ads", google_ads: "Google Ads" };
const PLATFORM_SHORT: Record<Platform, string> = { meta_ads: "Meta", google_ads: "Google" };

const int = (v: number) => Math.round(v).toLocaleString("pt-BR");
export const brDate = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

export function reportVariables(c: ClientPeriod, from: string, to: string): Record<string, string> {
  const div = (a: number, b: number) => (b > 0 ? a / b : null);
  const cpr = div(c.spendCents, c.conversions);
  const cpc = div(c.spendCents, c.clicks);
  const ctr = div(c.clicks, c.impressions);
  const cpm = div(c.spendCents * 1000, c.impressions);
  return {
    cliente: c.client,
    plataformas: c.platforms.map((p) => PLATFORM_NAME[p]).join(" e ") || "Anúncios",
    inicio: brDate(from),
    fim: brDate(to),
    investimento: formatBRL(c.spendCents),
    impressoes: int(c.impressions),
    alcance: int(c.reach),
    cliques: int(c.clicks),
    resultados: int(c.conversions),
    custo_por_resultado: cpr === null ? "—" : formatBRL(Math.round(cpr)),
    cpc: cpc === null ? "—" : formatBRL(Math.round(cpc)),
    ctr: ctr === null ? "—" : `${(ctr * 100).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}%`,
    cpm: cpm === null ? "—" : formatBRL(Math.round(cpm)),
  };
}

export function clientReport(kind: "semanal" | "mensal" | "diario", c: ClientPeriod, from: string, to: string, custom?: Templates | null) {
  const label = kind === "semanal" ? "Relatório semanal" : kind === "mensal" ? "Relatório mensal" : "Relatório diário";
  return { title: `${label} · ${c.client}`, text: render(templateFor(kind, custom), reportVariables(c, from, to)) };
}

// ----------------------------------------------------------------------------
// Alertas por conta

export type AccountInfo = { name: string; client: string | null; provider: Platform; status: string | null; isPrepay: boolean | null };

function accountVars(a: AccountInfo): Record<string, string> {
  return {
    conta: a.name,
    cliente: a.client ?? a.name,
    plataforma: PLATFORM_NAME[a.provider],
    plataforma_curta: PLATFORM_SHORT[a.provider],
    status: a.status || "—",
  };
}

export function balanceAlert(a: AccountInfo, balanceCents: number, limitCents: number, custom?: Templates | null) {
  const text = render(templateFor("alerta_saldo", custom), {
    ...accountVars(a),
    pagamento: a.isPrepay === true ? "Pré-paga" : a.isPrepay === false ? "Pós-paga" : "—",
    saldo: formatBRL(balanceCents),
    limite: formatBRL(limitCents),
  });
  return { title: `Saldo baixo na conta ${a.name}`, detail: `Saldo disponível: ${formatBRL(balanceCents)} (alerta abaixo de ${formatBRL(limitCents)}).`, text };
}

export function spendAlert(a: AccountInfo, spendCents: number, limitCents: number, custom?: Templates | null) {
  const text = render(templateFor("alerta_gasto", custom), { ...accountVars(a), gasto_hoje: formatBRL(spendCents), limite: formatBRL(limitCents) });
  return { title: `Gasto de hoje acima do limite em ${a.name}`, detail: `${formatBRL(spendCents)} gastos hoje (limite ${formatBRL(limitCents)}).`, text };
}

export function idleAlert(a: AccountInfo, day: string, custom?: Templates | null) {
  const text = render(templateFor("alerta_parado", custom), { ...accountVars(a), dia: brDate(day) });
  return { title: `${a.name} não gastou nada em ${brDate(day)}`, detail: "Confira o pagamento e se as campanhas estão ativas.", text };
}

export function connectionAlert(provider: Platform, custom?: Templates | null) {
  const text = render(templateFor("alerta_conexao", custom), { plataforma: PLATFORM_NAME[provider] });
  return { title: provider === "meta_ads" ? "Reconecte a conta da Meta" : "Reconecte a conta do Google Ads", detail: "O acesso às contas de anúncios expirou.", text };
}

export function testMessage(groupName: string, clients: number) {
  return {
    title: "Mensagem de teste",
    text: `✅ *Hub System conectado*\n\nEste grupo (${groupName}) vai receber os alertas e relatórios das contas de anúncio.\nClientes acompanhados agora: ${clients}.`,
  };
}

/** "Saldo disponível (R$2,65 BRL)" / "Available balance ($1,234.56 USD)" → centavos. */
export function parseFundingBalance(display: string | null | undefined): number | null {
  const m = display?.match(/\(([^)]*\d[^)]*)\)/);
  if (!m) return null;
  const raw = m[1].replace(/[^\d.,]/g, "");
  if (!raw) return null;
  // O último separador com 1–2 dígitos depois é o decimal.
  const dec = raw.match(/[.,](\d{1,2})$/);
  const whole = (dec ? raw.slice(0, -dec[0].length) : raw).replace(/[.,]/g, "");
  const cents = Number(whole) * 100 + (dec ? Number(dec[1].padEnd(2, "0")) : 0);
  return Number.isFinite(cents) ? cents : null;
}

/** Valores de exemplo dos alertas, a partir de uma conta real, para a prévia dos modelos. */
export function alertSampleVariables(a: AccountInfo & { balanceCents: number | null; limitCents: number | null }, day: string) {
  const base = accountVars(a);
  const limit = formatBRL(a.limitCents ?? 15000);
  return {
    alerta_saldo: { ...base, pagamento: a.isPrepay === false ? "Pós-paga" : "Pré-paga", saldo: formatBRL(a.balanceCents ?? 1975), limite: limit },
    alerta_gasto: { ...base, gasto_hoje: formatBRL(32000), limite: formatBRL(30000) },
    alerta_parado: { ...base, dia: brDate(day) },
    alerta_conexao: { plataforma: PLATFORM_NAME[a.provider] },
  };
}
