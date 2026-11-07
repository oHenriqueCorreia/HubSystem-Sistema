"use client";

import { Fragment, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, ChevronDown, CircleAlert, CircleCheck, LoaderCircle, RefreshCw, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FormField } from "@/components/app/form-field";
import { MoneyInput } from "@/components/app/money-input";
import { formatMoney } from "../format";
import { formatDateTime } from "@/domain/shared/dates";
import { DEFAULT_TEMPLATES, TEMPLATE_LABELS, TEMPLATE_VARIABLES, render, templateFor, unknownVariables, type TemplateKey } from "@/domain/ads/report-message";
import { loadReportGroups, saveAccountAlerts, saveReportSettings, saveReportTemplate, sendReportManual, sendReportTest } from "../report-actions";
import type { ReportAccount, ReportLogEntry, ReportNumber, ReportSettingsView } from "../report-queries";

const SUGGESTED_GROUP = /hubsystem\s*-\s*relat[oó]rios/i;
const TIMES = Array.from({ length: (22 - 5) * 4 + 1 }, (_, i) => {
  const m = 5 * 60 + i * 15;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});

/** *negrito* e _itálico_ como o WhatsApp mostra, sem HTML vindo do texto. */
function WaText({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).map((part, j) =>
            /^\*[^*\s][^*]*\*$/.test(part) ? (
              <strong key={j} className="font-semibold">
                {part.slice(1, -1)}
              </strong>
            ) : /^_[^_\s][^_]*_$/.test(part) ? (
              <em key={j}>{part.slice(1, -1)}</em>
            ) : (
              <Fragment key={j}>{part}</Fragment>
            ),
          )}
        </Fragment>
      ))}
    </>
  );
}

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message);
        after?.();
      } else toast.error(res.message);
      router.refresh();
    });
  return { pending, run };
}

type Group = { id: string; name: string };

function Toggle({ checked, onChange, title, detail, children }: { checked: boolean; onChange: (v: boolean) => void; title: string; detail: string; children?: React.ReactNode }) {
  return (
    <div className="grid gap-3 rounded-lg border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
      <label className="flex cursor-pointer items-start justify-between gap-4">
        <span className="grid gap-0.5">
          <span className="font-medium">{title}</span>
          <span className="text-xs text-muted-foreground">{detail}</span>
        </span>
        <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5 shrink-0" />
      </label>
      {checked && children}
    </div>
  );
}

/** initial: na primeira configuração, o servidor já traz os grupos do único WhatsApp conectado. */
export function DestinationPanel({
  settings,
  numbers,
  canManage,
  initial,
}: {
  settings: ReportSettingsView | null;
  numbers: ReportNumber[];
  canManage: boolean;
  initial: { numberId: string; groups: Group[] } | null;
}) {
  const { pending, run } = useRun();
  const [numberId, setNumberId] = useState<string | null>(settings?.whatsapp_number_id ?? initial?.numberId ?? null);
  const [groupId, setGroupId] = useState<string | null>(settings?.group_id ?? initial?.groups.find((g) => SUGGESTED_GROUP.test(g.name))?.id ?? null);
  const [groups, setGroups] = useState<Group[] | null>(settings?.group_id ? [{ id: settings.group_id, name: settings.group_name ?? "Grupo" }] : (initial?.groups ?? null));
  const [loading, setLoading] = useState(false);
  const [alerts, setAlerts] = useState(settings?.alerts_enabled ?? true);
  const [weekly, setWeekly] = useState(settings?.weekly_enabled ?? true);
  const [monthly, setMonthly] = useState(settings?.monthly_enabled ?? true);
  const [monthlyDay, setMonthlyDay] = useState(settings?.monthly_day ?? 1);
  const [daily, setDaily] = useState(settings?.daily_enabled ?? false);
  const [time, setTime] = useState((settings?.send_time ?? "08:30").slice(0, 5));

  async function fetchGroups(id: string, suggest: boolean) {
    setLoading(true);
    const res = await loadReportGroups({ numberId: id });
    setLoading(false);
    if (!res.ok) return void toast.error(res.message);
    setGroups(res.data);
    if (suggest) {
      const hit = res.data.find((g) => SUGGESTED_GROUP.test(g.name));
      if (hit) setGroupId(hit.id);
    }
  }

  const saved = Boolean(settings?.group_id);
  const dirty =
    numberId !== (settings?.whatsapp_number_id ?? null) ||
    groupId !== (settings?.group_id ?? null) ||
    alerts !== (settings?.alerts_enabled ?? true) ||
    weekly !== (settings?.weekly_enabled ?? true) ||
    monthly !== (settings?.monthly_enabled ?? true) ||
    monthlyDay !== (settings?.monthly_day ?? 1) ||
    daily !== (settings?.daily_enabled ?? false) ||
    time !== (settings?.send_time ?? "08:30").slice(0, 5);

  if (!canManage) {
    return (
      <section aria-labelledby="destino" className="grid gap-2 rounded-xl border bg-surface p-4 text-sm">
        <h2 id="destino" className="font-semibold">
          Envio no WhatsApp
        </h2>
        <p className="text-muted-foreground">
          {saved ? `Grupo “${settings?.group_name}”, às ${(settings?.send_time ?? "08:30").slice(0, 5)}.` : "Nenhum grupo configurado. Peça a um administrador."}
        </p>
      </section>
    );
  }

  const save = () =>
    run(() =>
      saveReportSettings({
        numberId,
        groupId,
        alertsEnabled: alerts,
        dailyEnabled: daily,
        weeklyEnabled: weekly,
        monthlyEnabled: monthly,
        monthlyDay,
        sendTime: time,
      }),
    );

  return (
    <section aria-labelledby="destino" className="grid gap-6 rounded-xl border bg-surface p-4 text-sm sm:p-5">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid content-start gap-4">
          <div className="grid gap-1">
            <h2 id="destino" className="text-base font-semibold">
              Para onde vão
            </h2>
            <p className="text-muted-foreground">Uma mensagem por cliente, todas no grupo escolhido, pelo WhatsApp conectado em Atendimento.</p>
          </div>
          {!numbers.length ? (
            <p className="flex gap-2 rounded-lg bg-warning-soft p-3 text-warning">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Nenhum WhatsApp conectado por QR Code. Conecte um em Comercial → Atendimento → Números conectados.
            </p>
          ) : (
            <>
              <FormField label="WhatsApp que envia">
                <Select
                  value={numberId ?? undefined}
                  onValueChange={(v) => {
                    setNumberId(v);
                    setGroupId(null);
                    setGroups(null);
                    void fetchGroups(v, true);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Escolha o número" />
                  </SelectTrigger>
                  <SelectContent>
                    {numbers.map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        {n.label}
                        {n.connected ? "" : " (desconectado)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <div className="flex items-end gap-2">
                <FormField label="Grupo" className="min-w-0 flex-1">
                  <Select value={groupId ?? undefined} onValueChange={setGroupId} disabled={!numberId || loading || !groups}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={loading ? "Buscando grupos…" : groups ? "Escolha o grupo" : "Escolha o número primeiro"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(groups ?? []).map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <Button variant="outline" size="icon" disabled={!numberId || loading} onClick={() => numberId && fetchGroups(numberId, false)} aria-label="Atualizar lista de grupos">
                  {loading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                </Button>
              </div>
              {groups && !groups.length && <p className="text-xs text-muted-foreground">Este WhatsApp não participa de nenhum grupo. Crie o grupo, adicione o número e atualize a lista.</p>}
            </>
          )}
          <FormField label="Horário dos relatórios" hint="Horário de Brasília. Os números vão até o dia anterior.">
            <Select value={time} onValueChange={setTime}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.replace(":", "h")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>

        <fieldset className="grid content-start gap-3">
          <legend className="mb-3 text-base font-semibold">O que é enviado</legend>
          <Toggle checked={weekly} onChange={setWeekly} title="Relatório semanal" detail={`Toda segunda às ${time.replace(":", "h")}, com os últimos 7 dias de cada cliente.`} />
          <Toggle checked={monthly} onChange={setMonthly} title="Relatório mensal" detail={`Os últimos 30 dias de cada cliente, às ${time.replace(":", "h")} do dia escolhido.`}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span id="dia-mensal" className="text-muted-foreground">
                Enviar todo dia
              </span>
              <Select value={String(monthlyDay)} onValueChange={(v) => setMonthlyDay(Number(v))}>
                <SelectTrigger size="sm" className="w-20" aria-labelledby="dia-mensal">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">do mês</span>
            </div>
          </Toggle>
          <Toggle checked={alerts} onChange={setAlerts} title="Alertas das contas" detail="Saldo baixo, gasto do dia acima do limite e conta parada, conferidos de hora em hora das 7h às 22h." />
          <Toggle checked={daily} onChange={setDaily} title="Relatório diário" detail={`Todo dia às ${time.replace(":", "h")}, com os números de ontem.`} />
        </fieldset>
      </div>

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button disabled={pending || !dirty || (Boolean(numberId) && !groupId && Boolean(groups?.length))} onClick={save}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar envio
        </Button>
        <Button variant="outline" disabled={pending || !saved || dirty} onClick={() => run(() => sendReportTest({}))}>
          <Send aria-hidden="true" /> Enviar teste
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={pending || !saved || dirty}>
              Enviar relatório agora <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => run(() => sendReportManual({ kind: "semanal" }))}>Semanal (últimos 7 dias)</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run(() => sendReportManual({ kind: "mensal" }))}>Mensal (últimos 30 dias)</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run(() => sendReportManual({ kind: "diario" }))}>Diário (ontem)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {dirty && saved && <p className="self-center text-xs text-muted-foreground">Salve para enviar com a configuração nova.</p>}
      </div>
    </section>
  );
}

export type Samples = Record<TemplateKey, { client: string; vars: Record<string, string> }[]>;

const ORDER: TemplateKey[] = ["semanal", "mensal", "diario", "alerta_saldo", "alerta_gasto", "alerta_parado", "alerta_conexao"];

export function TemplatesEditor({ custom, samples, groupName, canManage }: { custom: Partial<Record<string, string>>; samples: Samples; groupName: string | null; canManage: boolean }) {
  const { pending, run } = useRun();
  const [key, setKey] = useState<TemplateKey>("semanal");
  const [drafts, setDrafts] = useState<Partial<Record<TemplateKey, string>>>({});
  const [clientIdx, setClientIdx] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);

  const saved = templateFor(key, custom);
  const text = drafts[key] ?? saved;
  const dirty = text !== saved;
  const unknown = unknownVariables(key, text);
  const list = samples[key] ?? [];
  const sample = list[Math.min(clientIdx, Math.max(0, list.length - 1))];
  const isCustom = Boolean(custom[key]?.trim());

  function insert(variable: string) {
    const el = area.current;
    const token = `{${variable}}`;
    if (!el) return setDrafts((d) => ({ ...d, [key]: text + token }));
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    setDrafts((d) => ({ ...d, [key]: text.slice(0, start) + token + text.slice(end) }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <section aria-labelledby="modelos" className="grid gap-4">
      <div className="grid gap-1">
        <h2 id="modelos" className="text-base font-semibold">
          Modelos das mensagens
        </h2>
        <p className="text-sm text-muted-foreground">Edite o texto e use as variáveis entre chaves; a prévia mostra os números reais de cada cliente.</p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="grid gap-3">
          <FormField label="Mensagem">
            <Select
              value={key}
              onValueChange={(v) => {
                setKey(v as TemplateKey);
                setClientIdx(0);
              }}
            >
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORDER.map((k) => (
                  <SelectItem key={k} value={k}>
                    {TEMPLATE_LABELS[k]}
                    {custom[k]?.trim() ? " (editado)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Texto" error={unknown.length ? `Variável que não existe nesta mensagem: ${unknown.map((u) => `{${u}}`).join(", ")}` : undefined}>
            <Textarea
              ref={area}
              value={text}
              onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
              readOnly={!canManage}
              rows={14}
              maxLength={2000}
              spellCheck={false}
              className="min-h-64 text-sm leading-relaxed"
            />
          </FormField>

          <div className="grid gap-2">
            <p className="text-xs font-medium text-muted-foreground">Variáveis: toque para inserir</p>
            <ul className="flex flex-wrap gap-1.5">
              {Object.entries(TEMPLATE_VARIABLES[key]).map(([v, label]) => (
                <li key={v}>
                  <button
                    type="button"
                    onClick={() => insert(v)}
                    disabled={!canManage}
                    title={label}
                    className="rounded-md border bg-background px-2 py-1 text-xs hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
                  >
                    {`{${v}}`}
                    <span className="sr-only">: {label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={pending || !dirty || unknown.length > 0} onClick={() => run(() => saveReportTemplate({ key, text }), () => setDrafts((d) => ({ ...d, [key]: undefined })))}>
                {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar modelo
              </Button>
              {dirty && (
                <Button variant="ghost" onClick={() => setDrafts((d) => ({ ...d, [key]: undefined }))}>
                  Descartar mudanças
                </Button>
              )}
              {(isCustom || text !== DEFAULT_TEMPLATES[key]) && (
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => run(() => saveReportTemplate({ key, text: null }), () => setDrafts((d) => ({ ...d, [key]: undefined })))}
                >
                  <RotateCcw aria-hidden="true" /> Restaurar padrão
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="grid content-start gap-3 lg:sticky lg:top-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Como chega no grupo</h3>
            {list.length > 1 && (
              <Select value={String(clientIdx)} onValueChange={(v) => setClientIdx(Number(v))}>
                <SelectTrigger size="sm" className="w-48 max-w-full" aria-label="Cliente da prévia">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {list.map((s, i) => (
                    <SelectItem key={`${s.client}-${i}`} value={String(i)}>
                      {s.client}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid gap-2 rounded-2xl border bg-muted/60 p-3 sm:p-4">
            <p className="text-center text-xs text-muted-foreground">{groupName ?? "Grupo ainda não escolhido"}</p>
            <div aria-live="polite" className="max-w-[46ch] justify-self-start rounded-2xl rounded-tl-sm bg-success-soft px-3.5 py-2.5 text-sm leading-relaxed break-words text-foreground">
              {sample ? <WaText text={render(text, sample.vars)} /> : <span className="text-muted-foreground">Ative contas nos relatórios para ver a prévia com números reais.</span>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function alertSummary(a: ReportAccount) {
  const parts: string[] = [];
  if (a.alert_balance_below_cents != null) parts.push(`saldo abaixo de ${formatMoney(a.alert_balance_below_cents, a.currency)}`);
  if (a.alert_daily_spend_above_cents != null) parts.push(`gasto do dia acima de ${formatMoney(a.alert_daily_spend_above_cents, a.currency)}`);
  if (a.alert_no_spend) parts.push("conta parada");
  return parts;
}

export function AccountAlerts({ accounts, canManage }: { accounts: ReportAccount[]; canManage: boolean }) {
  return (
    <section aria-labelledby="alertas-contas" className="grid gap-3">
      <div className="grid gap-1">
        <h2 id="alertas-contas" className="text-base font-semibold">
          Alertas por conta
        </h2>
        <p className="text-sm text-muted-foreground">Defina o limite de cada conta. Só as contas ativas nos relatórios aparecem; ative mais em Anúncios → Contas.</p>
      </div>
      {!accounts.length ? (
        <p className="rounded-xl border border-dashed bg-surface p-4 text-sm text-muted-foreground">Nenhuma conta ativa nos relatórios ainda.</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-surface">
          {accounts.map((a) => {
            const parts = alertSummary(a);
            const low = a.alert_balance_below_cents != null && a.balance_cents != null && a.balance_cents < a.alert_balance_below_cents;
            return (
              <li key={a.id} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                <div className="min-w-0">
                  <p className="font-medium break-words">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.provider === "meta_ads" ? "Meta Ads" : "Google Ads"}
                    {a.client ? `, ${a.client}` : ""}
                    {a.is_prepay === true ? ", pré-paga" : a.is_prepay === false ? ", pós-paga" : ""}
                  </p>
                  <p className={cn("mt-1 text-xs", parts.length ? "text-foreground" : "text-muted-foreground")}>{parts.length ? `Avisa: ${parts.join("; ")}` : "Sem alertas"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                  {a.balance_cents != null && (
                    <p className={cn("text-xs tabular", low ? "font-medium text-danger" : "text-muted-foreground")}>
                      {a.is_prepay === false ? "A pagar" : "Saldo"}: {formatMoney(a.balance_cents, a.currency)}
                    </p>
                  )}
                  {canManage && <AlertsDialog account={a} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function AlertsDialog({ account }: { account: ReportAccount }) {
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState<number | null>(account.alert_balance_below_cents);
  const [spend, setSpend] = useState<number | null>(account.alert_daily_spend_above_cents);
  const [noSpend, setNoSpend] = useState(account.alert_no_spend);
  const { pending, run } = useRun();

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <BellRing aria-hidden="true" /> Editar alertas
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Alertas de {account.name}</DialogTitle>
          <DialogDescription>Conferidos de hora em hora. Cada aviso sai uma vez por dia, no grupo e nas notificações. Deixe em branco para desligar.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FormField
            label="Avisar quando o saldo ficar abaixo de"
            optional
            hint={account.provider === "google_ads" ? "No Google, vale para contas com orçamento de conta (faturamento mensal). Pagamento automático não informa saldo." : "Em conta pré-paga, é o saldo disponível."}
          >
            <MoneyInput value={balance} onChange={setBalance} />
          </FormField>
          <FormField label="Avisar quando o gasto do dia passar de" optional>
            <MoneyInput value={spend} onChange={setSpend} />
          </FormField>
          <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-3 text-sm">
            <span className="grid gap-0.5">
              <span className="font-medium">Avisar quando não gastar nada no dia</span>
              <span className="text-xs text-muted-foreground">Costuma indicar cartão recusado ou campanhas pausadas.</span>
            </span>
            <Switch checked={noSpend} onCheckedChange={setNoSpend} className="mt-0.5 shrink-0" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button disabled={pending} onClick={() => run(() => saveAccountAlerts({ id: account.id, balanceBelowCents: balance, dailySpendAboveCents: spend, noSpend }), () => setOpen(false))}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar alertas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const KIND: Record<ReportLogEntry["kind"], string> = { teste: "Teste", alerta: "Alerta", diario: "Diário", semanal: "Semanal", mensal: "Mensal" };

export function SendHistory({ log }: { log: ReportLogEntry[] }) {
  return (
    <section aria-labelledby="historico" className="grid gap-3">
      <h2 id="historico" className="text-base font-semibold">
        Últimos envios
      </h2>
      {!log.length ? (
        <p className="rounded-xl border border-dashed bg-surface p-4 text-sm text-muted-foreground">Nada enviado ainda. Use “Enviar teste” para conferir o grupo.</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-surface">
          {log.map((l) => (
            <li key={l.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
              <span className="text-xs text-muted-foreground tabular">{formatDateTime(l.sent_at)}</span>
              <span className="min-w-0 break-words">
                <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{KIND[l.kind]}</span>
                {l.title}
                {l.error && <span className="mt-0.5 block text-xs text-danger">{l.error}</span>}
              </span>
              {l.status === "enviado" ? (
                <span className="flex items-center gap-1 text-xs text-success">
                  <CircleCheck className="size-3.5" aria-hidden="true" /> Enviado
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-danger">
                  <CircleAlert className="size-3.5" aria-hidden="true" /> Falhou
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
