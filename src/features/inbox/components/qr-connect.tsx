"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, QrCode, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormAlert, FormField } from "@/components/app/form-field";
import { PasswordInput } from "@/components/app/password-input";
import { connectQrNumber, getQrState, reconnectQrNumber, type QrState } from "../qr-actions";
import { HistoryPanel, PairingBlock } from "./history-import";

const POLL_MS = 4000;

/**
 * Conecta um número por QR Code. Sem numberId, cria um número novo.
 * needsServer pede endereço e chave (número novo ou desconectado); sem ele, só gera outro QR.
 */
export function QrConnectDialog({ numberId, needsServer, newSession = false, label, variant = "default" }: { numberId?: string; needsServer: boolean; newSession?: boolean; label: string; variant?: "default" | "outline" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [connectedId, setConnectedId] = useState<string | null>(null);
  const [state, setState] = useState<QrState>({ state: "starting" });
  const [pending, startTransition] = useTransition();

  function close(next: boolean) {
    setOpen(next);
    if (!next) {
      setActiveId(null);
      setConnectedId(null);
      setApiKey("");
      setError(null);
      setState({ state: "starting" });
      router.refresh();
    }
  }

  const restart = useCallback(
    (id: string) => {
      setError(null);
      setState({ state: "starting" });
      startTransition(async () => {
        const res = await reconnectQrNumber({ id });
        if (!res.ok) return setError(res.message ?? "Não foi possível gerar o QR Code.");
        setActiveId(id);
      });
    },
    [],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await connectQrNumber({ url, apiKey, numberId });
      if (!res.ok) return setError(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message ?? "Não foi possível conectar.");
      setApiKey("");
      setActiveId(res.data.id);
    });
  }

  function startConfigured() {
    setError(null);
    setState({ state: "starting" });
    startTransition(async () => {
      const res = await connectQrNumber({ numberId });
      if (!res.ok) return setError(res.message ?? "Não foi possível conectar.");
      setActiveId(res.data.id);
    });
  }

  // Consulta o servidor enquanto a tela está aberta: o QR muda e a conexão pode cair ou completar.
  useEffect(() => {
    if (!open || !activeId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const res = await getQrState({ id: activeId }).catch(() => null);
      if (stopped) return;
      if (res?.ok) {
        setState(res.data);
        if (res.data.state === "connected") {
          toast.success(res.data.phone ? `WhatsApp ${res.data.phone} conectado.` : "WhatsApp conectado.");
          // Logo depois do QR Code é a hora de trazer as conversas antigas.
          setConnectedId(activeId);
          setActiveId(null);
          router.refresh();
          return;
        }
        if (res.data.state === "failed") return;
      }
      timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [open, activeId, router]);

  const scanning = Boolean(activeId);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v && !needsServer) {
          if (numberId && !newSession) restart(numberId);
          else startConfigured();
        }
        close(v);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant} size={variant === "outline" ? "sm" : "default"} className="justify-self-start">
          <QrCode aria-hidden="true" /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{connectedId ? "Compilar conversas" : "Conectar WhatsApp por QR Code"}</DialogTitle>
          <DialogDescription>{connectedId ? "WhatsApp conectado. Traga as conversas e os grupos que já estão nele, para gerir aqui e transformar em lead." : scanning ? "No celular, abra o WhatsApp, toque em Aparelhos conectados e depois em Conectar um aparelho." : "Funciona com qualquer número, usando o seu servidor de conexão."}</DialogDescription>
        </DialogHeader>

        {connectedId && <HistoryPanel numberId={connectedId} onDone={() => close(false)} />}

        {!connectedId && !scanning && needsServer && (
          <form id="qr-form" onSubmit={submit} className="grid gap-3" noValidate>
            <FormAlert>{error}</FormAlert>
            <FormField label="Endereço do servidor" required hint="O endereço público que aparece no fim da instalação.">
              <Input type="url" inputMode="url" placeholder="https://whatsapp.suaempresa.com.br…" value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" spellCheck={false} />
            </FormField>
            <FormField label="Chave do servidor" required>
              <PasswordInput value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
            </FormField>
            <p className="flex gap-2 rounded-lg border border-warning/50 bg-warning-soft p-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <span>Esta conexão não é oficial da Meta e o número pode ser bloqueado, principalmente com muitos envios para quem não te conhece. Evite usar o seu número principal no começo.</span>
            </p>
          </form>
        )}

        {!connectedId && !scanning && !needsServer && <FormAlert>{error}</FormAlert>}

        {scanning && (
          <div className="grid gap-3">
            <FormAlert>{error}</FormAlert>
            {activeId && <PairingBlock numberId={activeId} state={state} onRetry={() => restart(activeId)} retrying={pending} />}
          </div>
        )}

        {!connectedId && <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={pending && !scanning}>
            {scanning ? "Fechar" : "Cancelar"}
          </Button>
          {!scanning && needsServer && (
            <Button type="submit" form="qr-form" disabled={pending || !url || !apiKey}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Gerar QR Code
            </Button>
          )}
        </DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
