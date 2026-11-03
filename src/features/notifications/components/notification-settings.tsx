"use client";

import { useEffect, useState, useTransition } from "react";
import { BellOff, BellRing, LoaderCircle, Send, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormAlert } from "@/components/app/form-field";
import { getPushPublicKey, removePushSubscription, saveNotificationPrefs, savePushSubscription, sendTestPush } from "../actions";
import type { NotificationPrefs } from "../types";

type DeviceState = "carregando" | "sem_suporte" | "instalar_iphone" | "bloqueado" | "desativado" | "ativado";

function urlBase64ToBytes(value: string) {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Liga e desliga as notificações neste aparelho (celular ou computador). */
function DeviceCard() {
  const [state, setState] = useState<DeviceState>("carregando");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    (async () => {
      let next: DeviceState;
      if (isIos() && !isInstalled()) next = "instalar_iphone";
      else if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) next = "sem_suporte";
      else if (Notification.permission === "denied") next = "bloqueado";
      else {
        const reg = await navigator.serviceWorker.getRegistration();
        next = (await reg?.pushManager.getSubscription()) ? "ativado" : "desativado";
      }
      if (alive) setState(next);
    })().catch(() => alive && setState("sem_suporte"));
    return () => {
      alive = false;
    };
  }, []);

  function enable() {
    startTransition(async () => {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        if (permission === "denied") setState("bloqueado");
        return void toast.error("Sem a sua permissão, o aparelho não pode mostrar notificações.");
      }
      try {
        const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }));
        await navigator.serviceWorker.ready;
        const key = await getPushPublicKey({});
        if (!key.ok) return void toast.error(key.message);
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(key.data as string) });
        const json = sub.toJSON();
        const res = await savePushSubscription({ endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "", userAgent: navigator.userAgent.slice(0, 300) });
        if (!res.ok) {
          await sub.unsubscribe();
          return void toast.error(res.message);
        }
        setState("ativado");
        toast.success(res.message);
      } catch {
        toast.error("Não foi possível ativar neste aparelho. Atualize a página e tente de novo.");
      }
    });
  }

  function disable() {
    startTransition(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState("desativado");
      toast.success("Notificações desativadas neste aparelho.");
    });
  }

  function test() {
    startTransition(async () => {
      const res = await sendTestPush({});
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    });
  }

  return (
    <section aria-labelledby="aparelho" className="grid max-w-2xl gap-3 rounded-xl border bg-surface p-4">
      <div className="flex items-start gap-3">
        <Smartphone className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="grid gap-1">
          <h2 id="aparelho" className="text-sm font-semibold">
            Notificações neste aparelho
          </h2>
          <p className="text-sm text-muted-foreground">Os lembretes chegam como no WhatsApp, mesmo com o sistema fechado. Ative em cada aparelho que você usa.</p>
        </div>
      </div>

      {state === "carregando" && <p className="text-sm text-muted-foreground">Verificando este aparelho…</p>}
      {state === "sem_suporte" && <FormAlert tone="info">Este navegador não recebe notificações. No Android use o Chrome; no computador, Chrome ou Edge.</FormAlert>}
      {state === "instalar_iphone" && (
        <div className="grid gap-2 text-sm">
          <p className="font-medium">No iPhone, primeiro instale o app:</p>
          <ol className="grid list-decimal gap-1 pl-5">
            <li>Abra este site no Safari.</li>
            <li>Toque em Compartilhar e depois em “Adicionar à Tela de Início”.</li>
            <li>Abra o HubSystem pelo ícone novo e volte a esta tela.</li>
          </ol>
        </div>
      )}
      {state === "bloqueado" && <FormAlert tone="info">As notificações estão bloqueadas para este site. Libere nas configurações do navegador (ícone ao lado do endereço) e atualize a página.</FormAlert>}

      {(state === "desativado" || state === "ativado") && (
        <div className="flex flex-wrap gap-2">
          {state === "desativado" ? (
            <Button onClick={enable} disabled={pending}>
              {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <BellRing aria-hidden="true" />} Ativar neste aparelho
            </Button>
          ) : (
            <>
              <Button onClick={test} disabled={pending}>
                {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />} Enviar notificação de teste
              </Button>
              <Button variant="outline" onClick={disable} disabled={pending}>
                <BellOff aria-hidden="true" /> Desativar neste aparelho
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

const CATEGORIES: { key: "tarefas" | "agenda" | "financeiro" | "comercial"; label: string; hint: string }[] = [
  { key: "tarefas", label: "Tarefas", hint: "Perto do horário, no dia do prazo e quando atrasar." },
  { key: "agenda", label: "Agenda", hint: "Antes de cada compromisso. Eventos com lembrete próprio usam o que você escolheu neles." },
  { key: "financeiro", label: "Contas a pagar e a receber", hint: "Antes do vencimento, no dia e se vencer sem baixa. Avisos a partir das 8h." },
  { key: "comercial", label: "Comercial", hint: "Retorno combinado com leads e contratos perto do fim." },
];

function Minutes({ label, value, options, onChange }: { label: string; value: number; options: [number, string][]; onChange: (v: number) => void }) {
  const list = options.some(([v]) => v === value) ? options : [...options, [value, String(value)] as [number, string]];
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {list.map(([v, l]) => (
            <SelectItem key={v} value={String(v)}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

export function NotificationSettings({ initial }: { initial: NotificationPrefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof NotificationPrefs>(k: K, v: NotificationPrefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));

  function save() {
    startTransition(async () => {
      const res = await saveNotificationPrefs(prefs);
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    });
  }

  return (
    <div className="grid gap-8">
      <DeviceCard />

      <section aria-labelledby="lembretes" className="grid max-w-2xl gap-4">
        <h2 id="lembretes" className="text-sm font-semibold">
          O que me lembrar
        </h2>
        <ul className="grid divide-y rounded-xl border bg-surface">
          {CATEGORIES.map((c) => (
            <li key={c.key}>
              <label className="flex items-center justify-between gap-4 p-3">
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">{c.label}</span>
                  <span className="text-xs text-muted-foreground">{c.hint}</span>
                </span>
                <Switch checked={prefs[c.key]} onCheckedChange={(v) => set(c.key, v)} aria-label={c.label} />
              </label>
            </li>
          ))}
        </ul>

        <div className="grid gap-3 sm:grid-cols-3">
          <Minutes
            label="Tarefas: avisar antes"
            value={prefs.task_minutes}
            onChange={(v) => set("task_minutes", v)}
            options={[
              [15, "15 minutos"],
              [30, "30 minutos"],
              [60, "1 hora"],
              [120, "2 horas"],
              [1440, "1 dia"],
            ]}
          />
          <Minutes
            label="Agenda: avisar antes"
            value={prefs.event_minutes}
            onChange={(v) => set("event_minutes", v)}
            options={[
              [10, "10 minutos"],
              [15, "15 minutos"],
              [30, "30 minutos"],
              [60, "1 hora"],
              [120, "2 horas"],
            ]}
          />
          <Minutes
            label="Contas: avisar antes"
            value={prefs.bill_days}
            onChange={(v) => set("bill_days", v)}
            options={[
              [0, "Só no dia"],
              [1, "1 dia"],
              [2, "2 dias"],
              [3, "3 dias"],
              [5, "5 dias"],
              [7, "7 dias"],
            ]}
          />
        </div>

        <Button className="justify-self-start" onClick={save} disabled={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar preferências
        </Button>
      </section>
    </div>
  );
}
