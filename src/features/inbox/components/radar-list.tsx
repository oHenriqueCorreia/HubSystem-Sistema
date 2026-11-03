"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Repeat, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/app/form-field";
import { formatPhone } from "@/domain/shared/phone";
import { formatRelative } from "@/domain/shared/dates";
import { fillQuickReply, type QuickReply } from "@/domain/whatsapp/quick-replies";
import { enrollLead } from "@/features/tasks/actions";
import { sendWhatsAppMessage } from "../actions";
import type { RadarItem } from "../ops-queries";

const WINDOW_MS = 24 * 3600_000;

export function RadarList({
  id,
  title,
  empty,
  items,
  names,
  providers,
  now,
  quickReplies,
  cadences,
  canReply,
  canEnroll,
}: {
  id: string;
  title: string;
  empty: string;
  items: RadarItem[];
  names: Record<string, string>;
  providers: Record<string, "cloud" | "waha">;
  now: number;
  quickReplies: QuickReply[];
  cadences: { id: string; name: string }[];
  canReply: boolean;
  canEnroll: boolean;
}) {
  const [resuming, setResuming] = useState<RadarItem | null>(null);

  return (
    <section aria-labelledby={id} className="grid gap-2">
      <h2 id={id} className="text-sm font-semibold">
        {title} <span className="font-normal text-muted-foreground tabular">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="grid gap-2">
          {items.map((c) => {
            const blocked = Boolean(c.lead?.contact_opt_out_at);
            // Na API oficial, fora da janela de 24 horas só vale modelo: isso é feito na própria conversa.
            const freeText = providers[c.number_id] === "waha" || Boolean(c.last_inbound_at && now - new Date(c.last_inbound_at).getTime() < WINDOW_MS);
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-surface p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <Link href={`/atendimento?conversa=${c.id}`} className="font-medium break-words hover:underline">
                    {c.contact_name || formatPhone(c.contact_e164)}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    Parada {formatRelative(c.last_message_at)}
                    {c.assignee_id && names[c.assignee_id] ? `, com ${names[c.assignee_id]}` : ", sem responsável"}
                    {c.lead ? `. Lead: ${c.lead.name}` : ""}
                  </p>
                  {blocked && <p className="text-xs text-danger">O contato pediu para não receber mensagens.</p>}
                </div>
                {canReply && !blocked && freeText && (
                  <Button size="sm" variant="outline" onClick={() => setResuming(c)}>
                    <Send aria-hidden="true" /> Retomar
                  </Button>
                )}
                {canReply && !blocked && !freeText && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/atendimento?conversa=${c.id}`}>Enviar modelo</Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {resuming && <ResumeDialog item={resuming} quickReplies={quickReplies} cadences={canEnroll ? cadences : []} onClose={() => setResuming(null)} />}
    </section>
  );
}

function ResumeDialog({ item, quickReplies, cadences, onClose }: { item: RadarItem; quickReplies: QuickReply[]; cadences: { id: string; name: string }[]; onClose: () => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [cadence, setCadence] = useState("");
  const [pending, startTransition] = useTransition();
  const name = item.lead?.name ?? item.contact_name;

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, done: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.message);
      toast.success(res.message ?? done);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Retomar conversa</DialogTitle>
          <DialogDescription>Com {name || formatPhone(item.contact_e164)}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {quickReplies.length > 0 && (
            <FormField label="Resposta rápida" optional>
              <Select onValueChange={(v) => setText(fillQuickReply(quickReplies.find((r) => r.id === v)?.body ?? "", { name }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Escolha para preencher o texto" />
                </SelectTrigger>
                <SelectContent>
                  {quickReplies.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      /{r.shortcut}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
          <FormField label="Mensagem" required>
            <Textarea rows={4} value={text} maxLength={4096} onChange={(e) => setText(e.target.value)} />
          </FormField>
          <Button disabled={pending || !text.trim()} onClick={() => run(() => sendWhatsAppMessage({ conversationId: item.id, clientRef: crypto.randomUUID(), body: text }), "Mensagem enviada.")}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />} Enviar mensagem
          </Button>
          {item.lead && cadences.length > 0 && (
            <FormField label="Ou colocar em uma cadência" optional>
              <div className="flex items-center gap-2">
                <Select value={cadence} onValueChange={setCadence}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Escolha a cadência" />
                  </SelectTrigger>
                  <SelectContent>
                    {cadences.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" disabled={pending || !cadence} onClick={() => run(() => enrollLead({ leadId: item.lead!.id, templateId: cadence, startDate: null }), "Cadência iniciada.")}>
                  <Repeat aria-hidden="true" /> Iniciar
                </Button>
              </div>
            </FormField>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
