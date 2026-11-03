"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormAlert, FormField } from "@/components/app/form-field";
import { PasswordInput } from "@/components/app/password-input";
import { formatDateTime } from "@/domain/shared/dates";
import { TRIGGERS, type TriggerKey } from "@/domain/whatsapp/automations";
import type { QuickReply } from "@/domain/whatsapp/quick-replies";
import {
  createInboundHook,
  createWebhookEndpoint,
  deleteInboundHook,
  deleteQuickReply,
  deleteWebhookEndpoint,
  saveConversionSettings,
  saveInboxSettings,
  saveQuickReply,
} from "../ops-actions";

type Settings = { radar_client_minutes: number; radar_contact_hours: number; radar_notify: boolean; campaign_daily_limit: number; billing_enabled: boolean; billing_days_before: number; billing_message: string };
type Ops = {
  conversion: { enabled: boolean; dataset_id: string; waba_id: string | null } | null;
  conversionLog: { id: string; event_name: string; value_cents: number; status: string; error: string | null; created_at: string; ctwa_clid: string | null; provider: string | null }[];
  webhooks: { id: string; name: string; url: string; events: string[]; enabled: boolean }[];
  inbound: { id: string; name: string; last_used_at: string | null }[];
  billingLog: { transaction_id: string; status: string; detail: string | null; created_at: string }[];
};

const LOG_LABEL: Record<string, string> = { pendente: "Na fila", processando: "Enviando", enviado: "Enviado", erro: "Erro", ignorado: "Ignorado", bloqueado: "Bloqueado" };
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-3 rounded-xl border bg-surface p-4">
      <div>
        <h2 id={id} className="font-semibold">
          {title}
        </h2>
        {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function InboxSettingsPanel({ quickReplies, settings, ops, pipelines }: { quickReplies: QuickReply[]; settings: Settings; ops: Ops; pipelines: { id: string; name: string }[] }) {
  return (
    <div className="grid gap-4">
      <QuickRepliesSection replies={quickReplies} />
      <RadarAndBillingSection settings={settings} log={ops.billingLog} />
      <ConversionsSection current={ops.conversion} log={ops.conversionLog} />
      <WebhooksSection webhooks={ops.webhooks} inbound={ops.inbound} pipelines={pipelines} />
    </div>
  );
}

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function run<T>(fn: () => Promise<{ ok: true; data: T; message?: string } | { ok: false; message: string; fieldErrors?: Record<string, string[]> }>, after?: (data: T) => void) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message);
      if (res.message) toast.success(res.message);
      after?.(res.data);
      router.refresh();
    });
  }
  return { pending, run };
}

function QuickRepliesSection({ replies }: { replies: QuickReply[] }) {
  const { pending, run } = useAction();
  const [shortcut, setShortcut] = useState("");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<string | undefined>();

  return (
    <Section id="ajuste-respostas" title="Respostas rápidas" description="Digite / na conversa para usar. {nome} e {empresa} são preenchidos sozinhos. No QR Code, o atalho também serve nas cadências.">
      {replies.length > 0 && (
        <ul className="grid gap-1 text-sm">
          {replies.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">/{r.shortcut}</p>
                <p className="truncate text-xs text-muted-foreground">{r.body}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(r.id);
                  setShortcut(r.shortcut);
                  setBody(r.body);
                }}
              >
                Editar
              </Button>
              <Button size="icon-sm" variant="ghost" disabled={pending} aria-label={`Apagar /${r.shortcut}`} onClick={() => run(() => deleteQuickReply({ id: r.id }))}>
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <FormField label="Atalho">
          <Input value={shortcut} maxLength={30} spellCheck={false} placeholder="boas-vindas…" onChange={(e) => setShortcut(e.target.value)} />
        </FormField>
        <FormField label="Texto">
          <Textarea rows={2} value={body} maxLength={4096} onChange={(e) => setBody(e.target.value)} />
        </FormField>
      </div>
      <Button
        variant="outline"
        className="justify-self-start"
        disabled={pending || !shortcut.trim() || !body.trim()}
        onClick={() =>
          run(
            () => saveQuickReply({ id: editing, shortcut, body }),
            () => {
              setEditing(undefined);
              setShortcut("");
              setBody("");
            },
          )
        }
      >
        {editing ? "Salvar alteração" : "Adicionar resposta"}
      </Button>
    </Section>
  );
}

function RadarAndBillingSection({ settings, log }: { settings: Settings; log: Ops["billingLog"] }) {
  const { pending, run } = useAction();
  const [client, setClient] = useState(String(settings.radar_client_minutes));
  const [contact, setContact] = useState(String(settings.radar_contact_hours));
  const [notify, setNotify] = useState(settings.radar_notify);
  const [daily, setDaily] = useState(String(settings.campaign_daily_limit));
  const [billing, setBilling] = useState(settings.billing_enabled);
  const [days, setDays] = useState(String(settings.billing_days_before));
  const [message, setMessage] = useState(settings.billing_message);

  const save = () =>
    run(() =>
      saveInboxSettings({
        radarClientMinutes: Number(client),
        radarContactHours: Number(contact),
        radarNotify: notify,
        campaignDailyLimit: Number(daily),
        billingEnabled: billing,
        billingDaysBefore: Number(days),
        billingMessage: message,
      }),
    );

  return (
    <Section id="ajuste-limites" title="Radar, campanhas e cobrança">
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Cliente esperando (minutos)">
          <Input type="number" inputMode="numeric" min={5} max={10080} value={client} onChange={(e) => setClient(e.target.value)} />
        </FormField>
        <FormField label="Esperando o cliente (horas)">
          <Input type="number" inputMode="numeric" min={1} max={720} value={contact} onChange={(e) => setContact(e.target.value)} />
        </FormField>
        <FormField label="Limite de campanha por dia">
          <Input type="number" inputMode="numeric" min={1} max={2000} value={daily} onChange={(e) => setDaily(e.target.value)} />
        </FormField>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={notify} onCheckedChange={setNotify} /> Avisar quando o cliente passar do limite de espera
      </label>

      <div className="grid gap-3 border-t pt-3">
        <label className="flex items-start gap-2 text-sm">
          <Switch checked={billing} onCheckedChange={setBilling} className="mt-0.5" />
          <span>
            <span className="font-medium">Lembrete de cobrança pelo WhatsApp</span>
            <span className="block max-w-prose text-muted-foreground">
              Vale para contas a receber ligadas a um cliente, com telefone de cobrança e autorização registrada no lead. Cada conta recebe um lembrete, de segunda a sábado, das 8h às 20h. Na API oficial, só sai se o
              cliente tiver escrito nas últimas 24 horas.
            </span>
          </span>
        </label>
        {billing && (
          <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <FormField label="Dias antes do vencimento">
              <Input type="number" inputMode="numeric" min={0} max={30} value={days} onChange={(e) => setDays(e.target.value)} />
            </FormField>
            <FormField label="Mensagem" hint="Use {nome}, {descricao}, {valor} e {vencimento}.">
              <Textarea rows={3} value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} />
            </FormField>
          </div>
        )}
        {log.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Últimos lembretes</summary>
            <ul className="mt-2 grid gap-1">
              {log.map((l) => (
                <li key={l.transaction_id} className="text-xs text-muted-foreground">
                  {formatDateTime(l.created_at)}: {LOG_LABEL[l.status] ?? l.status}
                  {l.detail ? `, ${l.detail}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <Button variant="outline" className="justify-self-start" disabled={pending} onClick={save}>
        {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar ajustes
      </Button>
    </Section>
  );
}

function ConversionsSection({ current, log }: { current: Ops["conversion"]; log: Ops["conversionLog"] }) {
  const { pending, run } = useAction();
  const [enabled, setEnabled] = useState(current?.enabled ?? false);
  const [dataset, setDataset] = useState(current?.dataset_id ?? "");
  const [waba, setWaba] = useState(current?.waba_id ?? "");
  const [token, setToken] = useState("");

  return (
    <Section
      id="ajuste-conversoes"
      title="Retorno de vendas para a Meta"
      description="Quando um negócio é ganho, o sistema avisa a Meta com o valor da venda. Na API oficial, com a conta WABA e o clique do anúncio, a venda vai direto ao anúncio. No QR Code não existe WABA: vai só o telefone em hash, e a Meta nem sempre consegue ligar a venda ao anúncio."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="ID do conjunto de dados" required>
          <Input inputMode="numeric" value={dataset} autoComplete="off" onChange={(e) => setDataset(e.target.value)} />
        </FormField>
        <FormField label="ID da conta do WhatsApp Business" optional hint="Só na API oficial.">
          <Input inputMode="numeric" value={waba} autoComplete="off" onChange={(e) => setWaba(e.target.value)} />
        </FormField>
      </div>
      <FormField label="Token de acesso" required={!current} hint={current ? "Em branco, mantém o token salvo." : "Fica guardado cifrado e nunca volta para o navegador."}>
        <PasswordInput value={token} autoComplete="off" onChange={(e) => setToken(e.target.value)} />
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={enabled} onCheckedChange={setEnabled} /> Enviar as vendas ganhas para a Meta
      </label>
      <Button variant="outline" className="justify-self-start" disabled={pending || !dataset} onClick={() => run(() => saveConversionSettings({ enabled, datasetId: dataset, wabaId: waba, token }), () => setToken(""))}>
        {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar retorno de vendas
      </Button>
      {log.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Últimos envios</summary>
          <ul className="mt-2 grid gap-1">
            {log.map((l) => (
              <li key={l.id} className="text-xs break-words text-muted-foreground">
                {formatDateTime(l.created_at)}: {money(Number(l.value_cents))}, {LOG_LABEL[l.status] ?? l.status}
                {l.error ? `. ${l.error}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

function SecretShown({ label, value, onClose }: { label: string; value: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Copie agora</DialogTitle>
          <DialogDescription>Por segurança, isto aparece só esta vez.</DialogDescription>
        </DialogHeader>
        <FormField label={label}>
          <Input readOnly value={value} spellCheck={false} onFocus={(e) => e.target.select()} />
        </FormField>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(value).then(() => toast.success("Copiado."));
            }}
          >
            Copiar
          </Button>
          <Button onClick={onClose}>Já copiei</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WebhooksSection({ webhooks, inbound, pipelines }: { webhooks: Ops["webhooks"]; inbound: Ops["inbound"]; pipelines: { id: string; name: string }[] }) {
  const { pending, run } = useAction();
  const [shown, setShown] = useState<{ label: string; value: string } | null>(null);
  const [outOpen, setOutOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<TriggerKey[]>(["lead_criado"]);
  const [error, setError] = useState<string | null>(null);
  const [hookName, setHookName] = useState("");
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  const router = useRouter();
  const [saving, startSaving] = useTransition();

  function submitOut() {
    setError(null);
    startSaving(async () => {
      const res = await createWebhookEndpoint({ name, url, events });
      if (!res.ok) return setError(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message);
      setOutOpen(false);
      setName("");
      setUrl("");
      setShown({ label: "Segredo para conferir a assinatura (X-Hub-Signature-256)", value: res.data.secret });
      router.refresh();
    });
  }

  return (
    <Section id="ajuste-webhooks" title="Integrações por webhook" description="Saída: o sistema avisa outro programa quando algo acontece. Entrada: outro programa cria leads aqui.">
      <div className="grid gap-2">
        <h3 className="text-sm font-medium">Saída</h3>
        {webhooks.map((w) => (
          <div key={w.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium break-words">{w.name}</p>
              <p className="truncate text-xs text-muted-foreground">{w.url}</p>
            </div>
            <Button size="icon-sm" variant="ghost" disabled={pending} aria-label={`Apagar ${w.name}`} onClick={() => run(() => deleteWebhookEndpoint({ id: w.id }))}>
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ))}
        <Dialog open={outOpen} onOpenChange={(v) => !saving && setOutOpen(v)}>
          <DialogTrigger asChild>
            <Button variant="outline" className="justify-self-start">
              <Plus aria-hidden="true" /> Novo webhook de saída
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Novo webhook de saída</DialogTitle>
              <DialogDescription>O corpo vai assinado em HMAC-SHA256. Se falhar, o sistema tenta até 3 vezes.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <FormAlert>{error}</FormAlert>
              <FormField label="Nome" required>
                <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              </FormField>
              <FormField label="Endereço" required>
                <Input type="url" inputMode="url" spellCheck={false} placeholder="https://…" value={url} maxLength={500} onChange={(e) => setUrl(e.target.value)} />
              </FormField>
              <fieldset className="grid gap-1.5">
                <legend className="text-sm font-medium">Avisar quando</legend>
                {Object.entries(TRIGGERS).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={events.includes(k as TriggerKey)} onCheckedChange={(v) => setEvents((list) => (v ? [...list, k as TriggerKey] : list.filter((e) => e !== k)))} />
                    {label}
                  </label>
                ))}
              </fieldset>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOutOpen(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button onClick={submitOut} disabled={saving || name.trim().length < 2 || !url || !events.length}>
                {saving && <LoaderCircle className="animate-spin" aria-hidden="true" />} Criar webhook
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-2 border-t pt-3">
        <h3 className="text-sm font-medium">Entrada</h3>
        <p className="max-w-prose text-xs text-muted-foreground">
          Envie um POST em JSON com nome e telefone ou email. Também aceita empresa, observacoes, origem e autorizou_whatsapp. Telefone repetido não cria lead novo.
        </p>
        {inbound.map((h) => (
          <div key={h.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium break-words">{h.name}</p>
              <p className="text-xs text-muted-foreground">{h.last_used_at ? `Último uso em ${formatDateTime(h.last_used_at)}` : "Ainda não usado"}</p>
            </div>
            <ConfirmDialog
              tone="danger"
              trigger={
                <Button size="icon-sm" variant="ghost" aria-label={`Apagar ${h.name}`}>
                  <Trash2 aria-hidden="true" />
                </Button>
              }
              title="Apagar esta entrada?"
              description="O endereço para de funcionar na hora. Quem estiver usando deixa de criar leads."
              confirmLabel="Apagar"
              onConfirm={async () => run(() => deleteInboundHook({ id: h.id }))}
            />
          </div>
        ))}
        <div className="grid gap-2 sm:grid-cols-2">
          <FormField label="Nome">
            <Input value={hookName} maxLength={120} onChange={(e) => setHookName(e.target.value)} />
          </FormField>
          {pipelines.length > 0 && (
            <FormField label="Funil dos novos leads">
              <Select value={pipelineId} onValueChange={setPipelineId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pipelines.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        </div>
        <Button
          variant="outline"
          className="justify-self-start"
          disabled={pending || hookName.trim().length < 2}
          onClick={() =>
            run(
              () => createInboundHook({ name: hookName, pipelineId: pipelineId || null }),
              (data) => {
                setHookName("");
                setShown({ label: "Endereço para enviar os contatos", value: data.url });
              },
            )
          }
        >
          <Plus aria-hidden="true" /> Criar entrada
        </Button>
      </div>
      {shown && <SecretShown label={shown.label} value={shown.value} onClose={() => setShown(null)} />}
    </Section>
  );
}
