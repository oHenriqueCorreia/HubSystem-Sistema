"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LoaderCircle, Plug, RefreshCw, Unplug } from "lucide-react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { formatMoney } from "../format";
import { formatDateTime } from "@/domain/shared/dates";
import Link from "next/link";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { disconnectAds, setAccountClient, setAdAccountSelected, syncAdsNow } from "../actions";
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

export function AccountsList({ provider, accounts, clients, canManage }: { provider: "meta_ads" | "google_ads"; accounts: AdAccount[]; clients: AdClient[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [syncing, setSyncing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const active = accounts.filter((a) => a.is_selected).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const others = accounts.filter((a) => !a.is_selected).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const q = query.trim().toLowerCase();
  const shown = q ? others.filter((a) => a.name.toLowerCase().includes(q) || a.external_id.includes(q)) : others;
  const [open, setOpen] = useState(active.length === 0);
  if (!accounts.length) return null;

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

  const toggle = (a: AdAccount) =>
    canManage && (
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
    );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Nos relatórios ({active.length} de {accounts.length})
        </h3>
        <p className="flex flex-wrap gap-x-3 text-xs">
          <Link href="/anuncios/clientes" className="font-medium text-primary hover:underline">
            Organizar por cliente
          </Link>
          <Link href="/relatorios" className="font-medium text-primary hover:underline">
            Alertas e relatórios
          </Link>
        </p>
      </div>

      {active.length ? (
        <ul className="grid gap-2 md:grid-cols-2">
          {active.map((a) => (
            <li key={a.id} className="grid content-start gap-3 rounded-xl border bg-surface p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium break-words">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.external_id}, {a.currency}
                    {a.status ? `, ${a.status}` : ""}
                  </p>
                </div>
                {toggle(a)}
              </div>
              {canManage && clients.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground" id={`cliente-${a.id}`}>
                    Cliente
                  </span>
                  <Select value={a.ad_client_id ?? "__sem__"} disabled={pending} onValueChange={(v) => run(() => setAccountClient({ id: a.id, clientId: v === "__sem__" ? null : v }))}>
                    <SelectTrigger size="sm" className="w-56 max-w-full" aria-labelledby={`cliente-${a.id}`}>
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
              {provider === "meta_ads" && (
                <dl className="grid grid-cols-3 gap-2 border-t pt-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Saldo</dt>
                    <dd className="tabular">{a.balance_cents != null ? formatMoney(a.balance_cents, a.currency) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Limite de gastos</dt>
                    <dd className="tabular">{a.spend_cap_cents != null ? formatMoney(a.spend_cap_cents, a.currency) : "Sem limite"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Gasto total</dt>
                    <dd className="tabular">{a.amount_spent_cents != null ? formatMoney(a.amount_spent_cents, a.currency) : "—"}</dd>
                  </div>
                </dl>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed bg-surface p-3 text-sm text-muted-foreground">
          Nenhuma conta nos relatórios. Ative abaixo as contas que você acompanha; a sincronização roda na hora e traz 90 dias.
        </p>
      )}

      {others.length > 0 && (
        <Collapsible open={open} onOpenChange={setOpen} className="grid gap-2">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="justify-self-start">
              <ChevronDown className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
              {open ? "Esconder" : "Mostrar"} outras contas ({others.length})
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="grid gap-2">
            {others.length > 6 && (
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar conta pelo nome ou número…"
                aria-label="Buscar conta"
                className="max-w-sm"
                autoComplete="off"
              />
            )}
            <ul className="divide-y rounded-xl border bg-surface">
              {shown.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="break-words">{a.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.external_id}
                      {a.status ? `, ${a.status}` : ""}
                    </p>
                  </div>
                  {toggle(a)}
                </li>
              ))}
              {!shown.length && <li className="px-3 py-3 text-sm text-muted-foreground">Nenhuma conta com “{query}”.</li>}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
      {provider === "meta_ads" && active.length > 0 && (
        <p className="text-xs text-muted-foreground">“Saldo” é o valor informado pela Meta para a conta (em contas pós-pagas, o valor devido).</p>
      )}
    </div>
  );
}
