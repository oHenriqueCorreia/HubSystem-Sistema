"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, LoaderCircle, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { FormAlert, FormField } from "@/components/app/form-field";
import { formatOutcome, OUTCOMES } from "@/domain/whatsapp/outcomes";
import { createLeadFromConversation, sendWhatsAppTemplate, setConversationStatus } from "../actions";

type Template = { id: string; name: string; language: string; status: string; components: { type: string; text?: string }[] };

export function CloseDialog({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await setConversationStatus({ id: conversationId, status: "encerrada", outcome: formatOutcome(reason, note) });
      if (!res.ok) return void toast.error(res.message);
      toast.success(res.message);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Encerrar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Encerrar atendimento</DialogTitle>
          <DialogDescription>O motivo aparece nos indicadores do Atendimento e na linha do tempo do lead.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FormField label="Como terminou" required>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Escolha o motivo" />
              </SelectTrigger>
              <SelectContent>
                {OUTCOMES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Observação" optional>
            <Textarea rows={2} value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !reason}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Encerrar atendimento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TemplateDialog({ conversationId, templates }: { conversationId: string; templates: Template[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [id, setId] = useState(templates[0]?.id ?? "");
  const [params, setParams] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const tpl = templates.find((t) => t.id === id);
  const body = tpl?.components.find((c) => c.type === "BODY")?.text ?? "";
  const count = new Set(body.match(/\{\{\d+\}\}/g) ?? []).size;
  const preview = body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] || `{{${n}}}`);

  function submit() {
    startTransition(async () => {
      const res = await sendWhatsAppTemplate({ conversationId, clientRef: crypto.randomUUID(), templateId: id, params: params.slice(0, count) });
      if (!res.ok) return void toast.error(res.message);
      toast.success(res.message);
      setOpen(false);
      setParams([]);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>
        <Button type="button" size="xs" variant="ghost">
          <FileText aria-hidden="true" /> Modelo aprovado
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar modelo aprovado</DialogTitle>
          <DialogDescription>Modelos aprovados pela Meta podem ser enviados a qualquer momento, inclusive fora da janela de 24 horas.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FormField label="Modelo">
            <Select
              value={id}
              onValueChange={(v) => {
                setId(v);
                setParams([]);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} ({t.language})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {Array.from({ length: count }, (_, i) => (
            <FormField key={i} label={`Variável {{${i + 1}}}`} required>
              <Input value={params[i] ?? ""} maxLength={1000} onChange={(e) => setParams((p) => Object.assign([...p], { [i]: e.target.value }))} />
            </FormField>
          ))}
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Prévia</p>
            <p className="whitespace-pre-wrap">{preview || "Este modelo não tem texto no corpo."}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !id || params.slice(0, count).filter((p) => p?.trim()).length < count}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Enviar modelo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreateLeadDialog({ conversationId, defaultName, pipelines }: { conversationId: string; defaultName: string; pipelines: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createLeadFromConversation({ conversationId, name, company, email, pipelineId, notes, consent });
      if (!res.ok) return setError(res.fieldErrors?.name?.[0] ?? res.fieldErrors?.email?.[0] ?? res.message);
      toast.success(res.message);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <UserPlus aria-hidden="true" /> Criar lead
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Criar lead a partir da conversa</DialogTitle>
          <DialogDescription>O telefone vem da conversa. Se já existir um lead com ele, a conversa é vinculada sem duplicar.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FormAlert>{error}</FormAlert>
          <FormField label="Nome" required>
            <Input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} autoFocus />
          </FormField>
          <FormField label="Empresa" optional>
            <Input value={company} maxLength={160} onChange={(e) => setCompany(e.target.value)} />
          </FormField>
          <FormField label="E-mail" optional>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} spellCheck={false} />
          </FormField>
          {pipelines.length > 0 && (
            <FormField label="Funil">
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
          <FormField label="Observações" optional>
            <Textarea rows={2} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
          </FormField>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={consent} onCheckedChange={(v) => setConsent(Boolean(v))} className="mt-0.5" />
            O contato autorizou receber mensagens automáticas (cadências) pelo WhatsApp.
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || name.trim().length < 2 || !pipelineId}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Criar lead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
