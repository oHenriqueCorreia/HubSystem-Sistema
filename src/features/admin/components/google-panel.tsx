"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck2, CalendarSync, LoaderCircle, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { formatDateTime } from "@/domain/shared/dates";
import { disconnectGoogle, getGoogleCalendars, setBusyCalendars, syncGoogleNow } from "../google-actions";

const FREEBUSY = "https://www.googleapis.com/auth/calendar.freebusy";

type Connection = {
  google_email: string;
  status: string;
  last_synced_at: string | null;
  last_error: string | null;
  scopes?: string[] | null;
  busy_calendar_ids?: string[] | null;
  push_active?: boolean | null;
};

export function GooglePanel({
  configured,
  canManage,
  connection,
}: {
  configured: boolean;
  canManage: boolean;
  connection: Connection | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!configured) {
    return (
      <p className="max-w-prose text-sm text-muted-foreground">
        A integração ainda não foi ativada no servidor. O responsável técnico precisa cadastrar as credenciais OAuth do Google (GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET), a chave
        TOKEN_ENCRYPTION_KEY e a SUPABASE_SECRET_KEY nas variáveis de ambiente.
      </p>
    );
  }

  if (!connection) {
    return canManage ? (
      <div className="grid max-w-prose gap-3 text-sm">
        <p className="text-muted-foreground">
          Conecte sua conta para manter eventos e tarefas iguais nos dois lados, convidar pessoas por e-mail e ver seus horários livres. Pedimos acesso aos eventos, à lista de
          agendas e somente ao livre/ocupado (sem detalhes) para a disponibilidade.
        </p>
        <Button asChild className="justify-self-start">
          <a href="/api/google/oauth/start">
            <CalendarSync aria-hidden="true" /> Conectar Google Agenda
          </a>
        </Button>
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">Seu papel não permite gerenciar a agenda.</p>
    );
  }

  return (
    <div className="grid max-w-prose gap-3 text-sm">
      <dl className="grid gap-1">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Conta:</dt>
          <dd className="font-medium">{connection.google_email}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Situação:</dt>
          <dd className={connection.status === "ativa" ? "text-success" : "text-danger"}>{connection.status === "ativa" ? "Conectada" : connection.status === "revogada" ? "Acesso revogado" : "Com erro"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Última sincronização:</dt>
          <dd>{connection.last_synced_at ? formatDateTime(connection.last_synced_at) : "Nunca"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Atualização automática:</dt>
          <dd>{connection.push_active ? "Instantânea (notificações do Google)" : "Ao salvar no Hub System e uma vez por dia"}</dd>
        </div>
        {connection.last_error && <p className="text-danger" role="alert">{connection.last_error}</p>}
      </dl>
      {connection.status === "ativa" && !(connection.scopes ?? []).includes(FREEBUSY) && (
        <div className="grid gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3">
          <p>Para ver seus horários livres e escolher as agendas, reconecte a conta e aceite as novas permissões.</p>
          <Button asChild size="sm" className="justify-self-start">
            <a href="/api/google/oauth/start">
              <RefreshCw aria-hidden="true" /> Reconectar com as novas permissões
            </a>
          </Button>
        </div>
      )}
      {connection.status === "ativa" && (connection.scopes ?? []).includes(FREEBUSY) && <BusyCalendars selected={connection.busy_calendar_ids ?? ["primary"]} />}
      <div className="flex flex-wrap gap-2">
        {connection.status === "revogada" ? (
          <Button asChild>
            <a href="/api/google/oauth/start">Conectar novamente</a>
          </Button>
        ) : (
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await syncGoogleNow({});
                if (res.ok) toast.success(res.message);
                else toast.error(res.message);
                router.refresh();
              })
            }
          >
            {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <CalendarSync aria-hidden="true" />} Sincronizar agora
          </Button>
        )}
        <ConfirmDialog
          trigger={
            <Button variant="outline">
              <Unplug aria-hidden="true" /> Desconectar
            </Button>
          }
          title="Desconectar o Google Agenda?"
          description="O acesso é revogado no Google. Os eventos já trazidos continuam na sua agenda, mas deixam de ser sincronizados."
          confirmLabel="Desconectar"
          onConfirm={async () => {
            const res = await disconnectGoogle({});
            if (res.ok) toast.success(res.message);
            else toast.error(res.message);
            router.refresh();
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Eventos e tarefas com prazo vão para o Google assim que são salvos. Alterações feitas no Google voltam automaticamente; use “Sincronizar agora” se quiser forçar.
      </p>
    </div>
  );
}

/** Escolhe quais agendas do Google contam como "ocupado" na disponibilidade. */
function BusyCalendars({ selected }: { selected: string[] }) {
  const router = useRouter();
  const [items, setItems] = useState<{ id: string; summary: string; primary: boolean }[] | null>(null);
  const [value, setValue] = useState(selected);
  const [pending, startTransition] = useTransition();

  function load() {
    startTransition(async () => {
      const res = await getGoogleCalendars({});
      if (res.ok) setItems(res.data as { id: string; summary: string; primary: boolean }[]);
      else toast.error(res.message);
    });
  }

  function save() {
    startTransition(async () => {
      const res = await setBusyCalendars({ ids: value });
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
      router.refresh();
    });
  }

  if (!items) {
    return (
      <Button variant="outline" size="sm" className="justify-self-start" onClick={load} disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <CalendarCheck2 aria-hidden="true" />} Escolher agendas para a disponibilidade
      </Button>
    );
  }
  const ids = (id: string) => (id === items.find((i) => i.primary)?.id ? ["primary", id] : [id]);
  return (
    <fieldset className="grid gap-2 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Agendas que contam como ocupado</legend>
      {items.map((c) => {
        const checked = ids(c.id).some((x) => value.includes(x));
        return (
          <label key={c.id} className="flex min-h-8 items-center gap-2">
            <Checkbox
              checked={checked}
              onCheckedChange={(v) => setValue((cur) => (v ? [...cur.filter((x) => !ids(c.id).includes(x)), c.primary ? "primary" : c.id] : cur.filter((x) => !ids(c.id).includes(x))))}
            />
            {c.summary} {c.primary && <span className="text-xs text-muted-foreground">(principal)</span>}
          </label>
        );
      })}
      <Button size="sm" className="justify-self-start" onClick={save} disabled={pending || value.length === 0}>
        {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar agendas
      </Button>
    </fieldset>
  );
}
