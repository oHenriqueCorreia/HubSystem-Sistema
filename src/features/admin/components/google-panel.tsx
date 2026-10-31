"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarSync, LoaderCircle, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { formatDateTime } from "@/domain/shared/dates";
import { disconnectGoogle, syncGoogleNow } from "../google-actions";

export function GooglePanel({
  configured,
  canManage,
  connection,
}: {
  configured: boolean;
  canManage: boolean;
  connection: { google_email: string; status: string; last_synced_at: string | null; last_error: string | null } | null;
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
          Conecte sua conta para enviar seus eventos ao Google Agenda e trazer os compromissos de lá. Só pedimos acesso aos eventos da agenda.
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
        {connection.last_error && <p className="text-danger" role="alert">{connection.last_error}</p>}
      </dl>
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
      <p className="text-xs text-muted-foreground">A sincronização automática roda uma vez por dia; use “Sincronizar agora” para atualizar na hora.</p>
    </div>
  );
}
