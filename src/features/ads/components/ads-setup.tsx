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
import { disconnectAds, setAdAccountSelected, setAdAlerts, syncAdsNow } from "../actions";
import type { AdAccount, AdConnection } from "../queries";

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
      {!configured ? (
        <p className="text-muted-foreground">
          {provider === "meta_ads"
            ? "Integração ainda não ativada no servidor: faltam META_APP_ID e META_APP_SECRET (app da Meta for Developers com o produto Marketing API)."
            : "Integração ainda não ativada no servidor: falta GOOGLE_ADS_DEVELOPER_TOKEN (Central de API do Google Ads) e as credenciais OAuth do Google."}
        </p>
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

export function AccountsList({ accounts, canManage }: { accounts: AdAccount[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (!accounts.length) return null;

  return (
    <section aria-labelledby="contas" className="grid gap-2">
      <h2 id="contas" className="text-sm font-semibold">
        Contas de anúncio
      </h2>
      <ul className="grid gap-2 md:grid-cols-2">
        {accounts.map((a) => (
          <li key={a.id} className="grid gap-2 rounded-xl border bg-surface p-3 text-sm">
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
                  <Switch
                    checked={a.is_selected}
                    disabled={pending}
                    onCheckedChange={(v) =>
                      startTransition(async () => {
                        const res = await setAdAccountSelected({ id: a.id, selected: v });
                        if (res.ok) toast.success(res.message);
                        else toast.error(res.message);
                        router.refresh();
                      })
                    }
                    aria-label={`Usar ${a.name} nos relatórios`}
                  />
                  Nos relatórios
                </label>
              )}
            </div>
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
