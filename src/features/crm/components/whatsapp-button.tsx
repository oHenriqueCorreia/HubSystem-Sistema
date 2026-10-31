"use client";

import { useState, useTransition } from "react";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fillTemplate, formatPhone, whatsappLink } from "@/domain/shared/phone";
import { addActivity } from "../actions";
import type { MessageTemplate } from "../types";

/**
 * Abre o WhatsApp (wa.me) com uma mensagem preenchida. O envio é sempre feito
 * pela pessoa no WhatsApp — o sistema só registra a interação, se ela quiser.
 */
export function WhatsAppButton({
  leadId,
  dealId,
  phone,
  vars,
  templates,
  defaultMessage,
  size = "sm",
  label = "WhatsApp",
}: {
  leadId: string;
  dealId?: string | null;
  phone: string | null;
  vars: Record<string, string | null | undefined>;
  templates: MessageTemplate[];
  defaultMessage: string;
  size?: "sm" | "default" | "icon-sm";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string>("padrao");
  const [message, setMessage] = useState(() => fillTemplate(defaultMessage, vars));
  const [pending, startTransition] = useTransition();

  if (!phone) {
    return (
      <Button size={size} variant="outline" disabled title="Lead sem WhatsApp cadastrado">
        <MessageCircle aria-hidden="true" />
        {size !== "icon-sm" && label}
      </Button>
    );
  }

  function pick(id: string) {
    setTemplateId(id);
    const body = id === "padrao" ? defaultMessage : (templates.find((t) => t.id === id)?.body ?? "");
    setMessage(fillTemplate(body, vars));
  }

  function openWhatsApp() {
    window.open(whatsappLink(phone!, message), "_blank", "noopener,noreferrer");
    startTransition(async () => {
      const res = await addActivity({ leadId, dealId, type: "whatsapp", content: message || "Conversa iniciada pelo WhatsApp" });
      if (res.ok) toast.success("Conversa aberta e registrada na linha do tempo.");
      else toast.error(res.message);
      setOpen(false);
    });
  }

  return (
    <>
      <Button size={size} variant="outline" onClick={() => setOpen(true)} aria-label={size === "icon-sm" ? `WhatsApp ${formatPhone(phone)}` : undefined}>
        <MessageCircle aria-hidden="true" />
        {size !== "icon-sm" && label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conversar pelo WhatsApp</DialogTitle>
            <DialogDescription>
              {formatPhone(phone)} · a mensagem abre no WhatsApp para você revisar e enviar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="wa-template">Modelo</Label>
              <Select value={templateId} onValueChange={pick}>
                <SelectTrigger id="wa-template" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="padrao">Mensagem padrão</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="wa-message">Mensagem</Label>
              <Textarea id="wa-message" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={openWhatsApp} disabled={pending}>
              <MessageCircle aria-hidden="true" /> Abrir no WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
