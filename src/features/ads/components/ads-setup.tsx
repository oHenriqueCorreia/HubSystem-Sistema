"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, LoaderCircle, Plug, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormField } from "@/components/app/form-field";
import { MoneyInput } from "@/components/app/money-input";
import { formatMoney } from "../format";
import { formatDateTime } from "@/domain/shared/dates";
import Link from "next/link";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { disconnectAds, setAccountClient, setAdAccountSelected, setAdAlerts, syncAdsNow } from "../actions";
import type { AdAccount, AdClient, AdConnection } from "../queries";
import { IntegrationGuide } from "@/features/integrations/components/integration-guide";

const NAME = { meta_ads: "Meta Ads (Facebook e Instagram)", google_ads: "Google Ads" } as const;
const START = { meta_ads: "/api/ads/meta/start", google_ads: "/api/ads/google/start" } as const;
const STATUS: Record<string, string> = { ativa: "Conectada", erro: "Com erro", expirada: "Acesso expirado", revogada: "Acesso revogado" };

export function ProviderCard({
  provider,
  configured,
  connection,
  canManage,
}: {
  provider: "meta_ads" | "google_ads";
  configured: boolean;
  connection: AdConnection | undefined;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <section aria-label={NAME[provider]} className="grid content-start gap-3 rounded-xl border bg-surface p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{NAME[provider]}</h2>
        {connection && <Badge variant={connection.status === "ativa" ? "default" : "destructive"}>{STATUS[connection.status] ?? connection.status}</Badge>}
      </div>
      <IntegrationGuide id={provider} />
      {!configured ? (
        <p className="text-muted-foreground">Esta integração ainda não foi ativada neste sistema. Fale com o suporte pelo passo a passo.</p>
      ) : !connection ? (
        canManage ? (
          <>
            <p className="text-muted-foreground">Conecte a conta para listar as contas de anúncio autorizadas, acompanhar campanhas, gastos e métricas. O acesso é somente leitura.</p>
            <Button asChild className="justify-self-start">
              <a href={START[provider]}>
                <Plug aria-hidden="true" /> Conectar
              </a>
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground">Ainda não conectado. Peça a um administrador.</p>
        )
      ) : (
        <>
          <dl className="grid gap-1">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Conta:</dt>
              <dd>{connection.external_user || "—"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Última sincronização:</dt>
              <dd>{connection.last_synced_at ? formatDateTime(connection.last_synced_at) : "Nunca"}</dd>
            </div>
            {connection.expires_at && provider === "meta_ads" && (
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Acesso válido até:</dt>
                <dd>{formatDateTime(connection.expires_at)}</dd>
              </div>
            )}
          </dl>
          {connection.last_error && (
            <p role="alert" className="text-danger">
              {connection.last_error}
            </p>
          )}
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {connection.status === "ativa" ? (
                <Button
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await syncAdsNow({ provider });
                      if (res.ok) toast.success(res.message);
                      else toast.error(res.message);
                      router.refresh();
                    })
                  }
                >
                  {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />} Sincronizar agora
                </Button>
              ) : (
                <Button asChild>
                  <a href={START[provider]}>
                    <RefreshCw aria-hidden="true" /> Reconectar
                  </a>
                </Button>
              )}
              <ConfirmDialog
                trigger={
                  <Button variant="outline">
                    <Unplug aria-hidden="true" /> Desconectar
                  </Button>
                }
                title={`Desconectar ${NAME[provider]}?`}
                description="O acesso é revogado e a sincronização para. As métricas já trazidas continuam disponíveis para consulta."
                confirmLabel="Desconectar"
                onConfirm={async () => {
                  const res = await disconnectAds({ provider });
                  if (res.ok) toast.success(res.message);
                  else toast.error(res.message);
                  router.refresh();
                }}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function AccountsList({ accounts, clients, canManage }: { accounts: AdAccount[]; clients: AdClient[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [syncing, setSyncing] = useState<string | null>(null);
  if (!accounts.length) return null;
  // Contas nos relatórios primeiro; depois por nome.
  const sorted = [...accounts].sort((a, b) => Number(b.is_selected) - Number(a.is_selected) || a.name.localeCompare(b.name));

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, accountId?: string) {
    if (accountId) setSyncing(accountId);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
      setSyncing(null);
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="contas" className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="contas" className="text-sm font-semibold">
          Contas de anúncio ({accounts.length})
        </h2>
        <p className="text-xs text-muted-foreground">
          Ative “Nos relatórios” nas contas que você acompanha. A sincronização roda na hora e traz 90 dias.{" "}
          <Link href="/anuncios/clientes" className="font-medium text-primary hover:underline">
            Organizar por cliente
          </Link>
        </p>
      </div>
      <ul className="grid gap-2 md:grid-cols-2">
        {sorted.map((a) => (
          <li key={a.id} className="grid content-start gap-2 rounded-xl border bg-surface p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{a.name}</p>
                <p className="text-xs text-muted-foreground">
                  {a.provider === "meta_ads" ? "Meta" : "Google"} · {a.external_id} · {a.currency}
                  {a.status ? ` · ${a.status}` : ""}
                </p>
              </div>
              {canManage && (
                <label className="flex shrink-0 items-center gap-2 text-xs">
                  {syncing === a.id ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
                  <Switch
                    checked={a.is_selected}
                    disabled={pending}
                    onCheckedChange={(v) => run(() => setAdAccountSelected({ id: a.id, selected: v }), v ? a.id : undefined)}
                    aria-label={`Usar ${a.name} nos relatórios`}
                  />
                  {syncing === a.id ? "Sincronizando…" : "Nos relatórios"}
                </label>
              )}
            </div>
            {canManage && clients.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground" id={`cliente-${a.id}`}>
                  Cliente
                </span>
                <Select value={a.ad_client_id ?? "__sem__"} disabled={pending} onValueChange={(v) => run(() => setAccountClient({ id: a.id, clientId: v === "__sem__" ? null : v }))}>
                  <SelectTrigger size="sm" className="w-56" aria-labelledby={`cliente-${a.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__sem__">Sem cliente</SelectItem>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <dl className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-muted-foreground">Saldo</dt>
                <dd className="tabular">{a.balance_cents != null ? formatMoney(a.balance_cents, a.currency) : "Indisponível pela API"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Limite de gastos</dt>
                <dd className="tabular">{a.spend_cap_cents != null ? formatMoney(a.spend_cap_cents, a.currency) : a.provider === "meta_ads" ? "Sem limite" : "Indisponível pela API"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Gasto total</dt>
                <dd className="tabular">{a.amount_spent_cents != null ? formatMoney(a.amount_spent_cents, a.currency) : "Indisponível pela API"}</dd>
              </div>
            </dl>
            {canManage && a.is_selected && <AlertsDialog account={a} />}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Na Meta, “saldo” é o valor informado pela plataforma para a conta (em contas pós-pagas, o valor devido). O Google Ads não informa saldo nem limite pela API de relatórios.
      </p>
    </section>
  );
}

function AlertsDialog({ account }: { account: AdAccount }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState<number | null>(account.alert_balance_below_cents);
  const [spend, setSpend] = useState<number | null>(account.alert_daily_spend_above_cents);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await setAdAlerts({ id: account.id, balanceBelowCents: balance, dailySpendAboveCents: spend });
      if (!res.ok) return void toast.error(res.message);
      toast.success(res.message);
      setOpen(false);
      router.refresh();
    });
  }

  const active = account.alert_balance_below_cents != null || account.alert_daily_spend_above_cents != null;
  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="justify-self-start">
          <BellRing aria-hidden="true" /> {active ? "Alertas ativos" : "Criar alertas"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Alertas de {account.name}</DialogTitle>
          <DialogDescription>Você recebe uma notificação por dia quando a condição for atingida. Deixe em branco para desligar.</DialogDescription>
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar alertas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
