"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, CircleAlert, CircleCheck, LoaderCircle, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import { MoneyInput } from "@/components/app/money-input";
import { formatMoney } from "../format";
import { formatDateTime } from "@/domain/shared/dates";
import { loadReportGroups, saveAccountAlerts, saveReportSettings, sendReportManual, sendReportTest } from "../report-actions";
import type { ReportAccount, ReportLogEntry, ReportNumber, ReportSettingsView } from "../report-queries";

const SUGGESTED_GROUP = /hubsystem\s*-\s*relat[oó]rios/i;

/** *negrito* e _itálico_ como o WhatsApp mostra, sem HTML vindo do texto. */
function WaText({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).map((part, j) =>
            /^\*[^*]+\*$/.test(part) ? (
              <strong key={j} className="font-semibold">
                {part.slice(1, -1)}
              </strong>
            ) : /^_[^_]+_$/.test(part) ? (
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
  const [daily, setDaily] = useState(settings?.daily_enabled ?? true);
  const [weekly, setWeekly] = useState(settings?.weekly_enabled ?? true);

  async function fetchGroups(id: string, suggest: boolean) {
    setLoading(true);
    const res = await loadReportGroups({ numberId: id });
    setLoading(false);
    if (!res.ok) return void toast.error(res.message);
    setGroups(res.data);
    // Primeira configuração: já sugere o grupo criado para os relatórios.
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
    daily !== (settings?.daily_enabled ?? true) ||
    weekly !== (settings?.weekly_enabled ?? true);

  if (!canManage) {
    return (
      <section aria-labelledby="destino" className="grid gap-2 rounded-xl border bg-surface p-4 text-sm">
        <h2 id="destino" className="font-semibold">
          Para onde vão as mensagens
        </h2>
        <p className="text-muted-foreground">{saved ? `Grupo “${settings?.group_name}” no WhatsApp.` : "Nenhum grupo configurado. Peça a um administrador."}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="destino" className="grid gap-5 rounded-xl border bg-surface p-4 text-sm sm:p-5">
      <div className="grid gap-1">
        <h2 id="destino" className="text-base font-semibold">
          Para onde vão as mensagens
        </h2>
        <p className="text-muted-foreground">O Hub envia pelo WhatsApp conectado por QR Code em Atendimento, direto no grupo escolhido.</p>
      </div>

      {!numbers.length ? (
        <p className="flex gap-2 rounded-lg bg-warning-soft p-3 text-warning">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Nenhum WhatsApp conectado por QR Code. Conecte um em Comercial → Atendimento → Números conectados.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
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
          <div className="grid content-start gap-2">
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
          </div>
        </div>
      )}

      <fieldset className="grid gap-3">
        <legend className="mb-2 font-medium">O que é enviado</legend>
        <Toggle checked={alerts} onChange={setAlerts} title="Alertas" detail="Saldo baixo, gasto do dia acima do limite, conta que parou de gastar e conexão expirada. Cada alerta sai uma vez por dia." />
        <Toggle checked={daily} onChange={setDaily} title="Relatório diário" detail="Todo dia por volta das 7h, com os números de ontem de cada conta." />
        <Toggle checked={weekly} onChange={setWeekly} title="Resumo semanal" detail="Às segundas por volta das 7h, com os últimos 7 dias comparados à semana anterior." />
      </fieldset>

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button
          disabled={pending || !dirty || (Boolean(numberId) && !groupId && Boolean(groups?.length))}
          onClick={() => run(() => saveReportSettings({ numberId, groupId, alertsEnabled: alerts, dailyEnabled: daily, weeklyEnabled: weekly }))}
        >
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar
        </Button>
        <Button variant="outline" disabled={pending || !saved || dirty} onClick={() => run(() => sendReportTest({}))} title={dirty ? "Salve antes de enviar" : undefined}>
          <Send aria-hidden="true" /> Enviar teste
        </Button>
        <Button variant="ghost" disabled={pending || !saved || dirty} onClick={() => run(() => sendReportManual({ kind: "diario" }))}>
          Enviar relatório de ontem
        </Button>
      </div>
    </section>
  );
}

function Toggle({ checked, onChange, title, detail }: { checked: boolean; onChange: (v: boolean) => void; title: string; detail: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
      <span className="grid gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5 shrink-0" />
    </label>
  );
}

const PREVIEW_TABS = [
  { key: "diario", label: "Diário" },
  { key: "semanal", label: "Semanal" },
  { key: "alerta", label: "Alerta" },
] as const;

export function MessagePreview({ previews, groupName }: { previews: Record<(typeof PREVIEW_TABS)[number]["key"], string>; groupName: string | null }) {
  const [tab, setTab] = useState<(typeof PREVIEW_TABS)[number]["key"]>("diario");
  return (
    <section aria-labelledby="previa" className="grid content-start gap-3 lg:sticky lg:top-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="previa" className="text-base font-semibold">
          Como chega no grupo
        </h2>
        <div role="group" aria-label="Tipo de mensagem" className="flex gap-1 rounded-lg bg-muted p-1">
          {PREVIEW_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                tab === t.key ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2 rounded-2xl border bg-muted/60 p-3 sm:p-4">
        <p className="text-center text-xs text-muted-foreground">{groupName ?? "Grupo ainda não escolhido"}</p>
        <div aria-live="polite" className="max-w-[46ch] justify-self-start rounded-2xl rounded-tl-sm bg-success-soft px-3.5 py-2.5 text-sm leading-relaxed break-words text-foreground">
          <WaText text={previews[tab]} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">A prévia usa os números reais das contas ativas nos relatórios.</p>
    </section>
  );
}

function alertSummary(a: ReportAccount) {
  const parts: string[] = [];
  if (a.alert_balance_below_cents != null) parts.push(`saldo abaixo de ${formatMoney(a.alert_balance_below_cents, a.currency)}`);
  if (a.alert_daily_spend_above_cents != null) parts.push(`gasto do dia acima de ${formatMoney(a.alert_daily_spend_above_cents, a.currency)}`);
  if (a.alert_no_spend) parts.push("parou de gastar");
  return parts;
}

export function AccountAlerts({ accounts, canManage }: { accounts: ReportAccount[]; canManage: boolean }) {
  return (
    <section aria-labelledby="alertas-contas" className="grid gap-3">
      <div className="grid gap-1">
        <h2 id="alertas-contas" className="text-base font-semibold">
          Alertas por conta
        </h2>
        <p className="text-sm text-muted-foreground">Só as contas ativas nos relatórios aparecem aqui. Ative mais contas em Anúncios → Contas.</p>
      </div>
      {!accounts.length ? (
        <p className="rounded-xl border border-dashed bg-surface p-4 text-sm text-muted-foreground">Nenhuma conta ativa nos relatórios ainda.</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-surface">
          {accounts.map((a) => {
            const parts = alertSummary(a);
            return (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium break-words">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.provider === "meta_ads" ? "Meta" : "Google"}
                    {a.client ? `, ${a.client}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <p className={cn("text-xs", parts.length ? "text-foreground" : "text-muted-foreground")}>{parts.length ? `Avisa: ${parts.join("; ")}` : "Sem alertas"}</p>
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
          <DialogDescription>O aviso aparece nas notificações e no grupo do WhatsApp, uma vez por dia. Deixe em branco para desligar.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {account.provider === "meta_ads" && (
            <FormField label="Avisar quando o saldo ficar abaixo de" optional>
              <MoneyInput value={balance} onChange={setBalance} />
            </FormField>
          )}
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
          <Button
            disabled={pending}
            onClick={() => run(() => saveAccountAlerts({ id: account.id, balanceBelowCents: account.provider === "meta_ads" ? balance : null, dailySpendAboveCents: spend, noSpend }), () => setOpen(false))}
          >
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar alertas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const KIND: Record<ReportLogEntry["kind"], string> = { teste: "Teste", alerta: "Alerta", diario: "Diário", semanal: "Semanal" };

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
            <li key={l.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[8rem_1fr_auto] sm:items-center sm:gap-4">
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
