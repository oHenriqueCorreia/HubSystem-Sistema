"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plug, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormAlert, FormField } from "@/components/app/form-field";
import { PasswordInput } from "@/components/app/password-input";
import { connectWhatsAppNumber, disconnectWhatsAppNumber, syncWhatsAppTemplates } from "../actions";

type WaNumber = { id: string; display_phone: string; verified_name: string; status: string; quality: string | null; last_error: string | null };

export function WhatsAppSetup({ numbers, configured, canManage, templateCount }: { numbers: WaNumber[]; configured: boolean; canManage: boolean; templateCount: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!configured) {
    return (
      <p className="max-w-prose text-sm text-muted-foreground">
        O WhatsApp ainda não foi ativado no servidor. O responsável técnico precisa cadastrar META_APP_SECRET e WHATSAPP_VERIFY_TOKEN e registrar o webhook no app da Meta
        (veja a documentação do projeto).
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {numbers.map((n) => (
        <div key={n.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-surface p-3 text-sm">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {n.verified_name || "Número"} · {n.display_phone}
            </p>
            <p className="text-xs text-muted-foreground">
              {n.quality ? `Qualidade: ${n.quality === "GREEN" ? "alta" : n.quality === "YELLOW" ? "média" : n.quality === "RED" ? "baixa" : n.quality} · ` : ""}
              {templateCount} modelo(s) sincronizado(s)
            </p>
            {n.last_error && <p className="text-xs text-danger">{n.last_error}</p>}
          </div>
          <Badge variant={n.status === "ativo" ? "default" : "outline"}>{n.status === "ativo" ? "Conectado" : n.status === "erro" ? "Com erro" : "Desconectado"}</Badge>
          {canManage && n.status === "ativo" && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await syncWhatsAppTemplates({ numberId: n.id });
                    if (res.ok) toast.success(res.message);
                    else toast.error(res.message);
                    router.refresh();
                  })
                }
              >
                {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />} Sincronizar modelos
              </Button>
              <ConfirmDialog
                tone="danger"
                trigger={
                  <Button variant="ghost" size="sm">
                    <Unplug aria-hidden="true" /> Desconectar
                  </Button>
                }
                title="Desconectar este número?"
                description="O token é apagado e o sistema para de enviar e receber por este número. O histórico de conversas continua disponível."
                confirmLabel="Desconectar"
                onConfirm={async () => {
                  const res = await disconnectWhatsAppNumber({ id: n.id });
                  if (res.ok) toast.success(res.message);
                  else toast.error(res.message);
                  router.refresh();
                }}
              />
            </>
          )}
        </div>
      ))}
      {canManage && <ConnectDialog />}
    </div>
  );
}

function ConnectDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phoneNumberId, setPhone] = useState("");
  const [wabaId, setWaba] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await connectWhatsAppNumber({ phoneNumberId, wabaId, token });
      if (!res.ok) return setError(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message);
      toast.success(res.message);
      setOpen(false);
      setToken("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>
        <Button className="justify-self-start">
          <Plug aria-hidden="true" /> Conectar número (API oficial)
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Conectar número do WhatsApp Business</DialogTitle>
          <DialogDescription>
            Dados do Gerenciador do WhatsApp na Meta (WhatsApp → Configuração da API). Use um token permanente de usuário do sistema com as permissões
            whatsapp_business_messaging e whatsapp_business_management. O token é guardado cifrado e nunca volta para o navegador.
          </DialogDescription>
        </DialogHeader>
        <form id="wa-form" onSubmit={submit} className="grid gap-3" noValidate>
          <FormAlert>{error}</FormAlert>
          <FormField label="ID do número de telefone" required>
            <Input inputMode="numeric" value={phoneNumberId} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
          </FormField>
          <FormField label="ID da conta do WhatsApp Business (WABA)" required>
            <Input inputMode="numeric" value={wabaId} onChange={(e) => setWaba(e.target.value)} autoComplete="off" />
          </FormField>
          <FormField label="Token de acesso permanente" required>
            <PasswordInput value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form="wa-form" disabled={pending || !phoneNumberId || !wabaId || !token}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Validar e conectar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
