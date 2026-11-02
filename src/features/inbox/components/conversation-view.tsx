"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Ban, Check, CheckCheck, Clock, FileText, LoaderCircle, Lock, Megaphone, Send, Star, TriangleAlert, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { FormAlert, FormField } from "@/components/app/form-field";
import { formatDateTime } from "@/domain/shared/dates";
import { formatPhone } from "@/domain/shared/phone";
import { TagPicker } from "@/features/tags/components/tag-picker";
import type { Tag } from "@/features/crm/types";
import {
  addInternalNote,
  assignConversation,
  createLeadFromConversation,
  markConversationRead,
  sendWhatsAppMessage,
  sendWhatsAppTemplate,
  setConversationStatus,
  setConversationTags,
  toggleImportant,
} from "../actions";
import type { ConversationOrigin, Message } from "../queries";

type Owner = { id: string; full_name: string; email: string };
type Template = { id: string; name: string; language: string; status: string; components: { type: string; text?: string }[] };
type Conversation = {
  id: string;
  contact_e164: string;
  contact_name: string;
  status: string;
  assignee_id: string | null;
  last_inbound_at: string | null;
  lead: { id: string; name: string; contact_opt_out_at: string | null } | null;
  tagIds: string[];
  messages: Message[];
  origin: ConversationOrigin | null;
};

const time = (iso: string) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(iso));
const STATUS_ICON: Record<string, { icon: typeof Check; label: string }> = {
  enviando: { icon: Clock, label: "Enviando" },
  enviada: { icon: Check, label: "Enviada" },
  entregue: { icon: CheckCheck, label: "Entregue" },
  lida: { icon: CheckCheck, label: "Lida" },
  erro: { icon: TriangleAlert, label: "Erro no envio" },
};

export function ConversationView({
  conversation,
  owners,
  templates,
  tags,
  pipelines,
  names,
  canReply,
  canManage,
  canCreateLead,
}: {
  conversation: Conversation;
  owners: Owner[];
  templates: Template[];
  tags: Tag[];
  pipelines: { id: string; name: string }[];
  names: Record<string, string>;
  canReply: boolean;
  canManage: boolean;
  canCreateLead: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"cliente" | "nota">("cliente");
  const [tagIds, setTagIds] = useState(conversation.tagIds);
  const [pending, startTransition] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);
  const [now] = useState(() => Date.now());
  const windowOpen = Boolean(conversation.last_inbound_at && now - new Date(conversation.last_inbound_at).getTime() < 24 * 3600_000);
  const blocked = Boolean(conversation.lead?.contact_opt_out_at);
  const approved = useMemo(() => templates.filter((t) => t.status === "APPROVED"), [templates]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [conversation.messages.length]);

  useEffect(() => {
    void markConversationRead({ id: conversation.id });
  }, [conversation.id]);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.message);
      if (res.message) toast.success(res.message);
      after?.();
      router.refresh();
    });
  }

  function send() {
    const body = text.trim();
    if (!body) return;
    if (mode === "nota") return run(() => addInternalNote({ conversationId: conversation.id, body }), () => setText(""));
    // clientRef estável por envio: um duplo clique não manda duas mensagens.
    const clientRef = crypto.randomUUID();
    run(() => sendWhatsAppMessage({ conversationId: conversation.id, clientRef, body }), () => setText(""));
  }

  return (
    <section aria-label={`Conversa com ${conversation.contact_name || conversation.contact_e164}`} className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b p-3">
        <Button asChild variant="ghost" size="icon-sm" className="md:hidden">
          <Link href="/atendimento" aria-label="Voltar para a lista">
            <ArrowLeft aria-hidden="true" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{conversation.contact_name || formatPhone(conversation.contact_e164)}</h2>
          <p className="text-xs text-muted-foreground">
            {formatPhone(conversation.contact_e164)}
            {conversation.lead && (
              <>
                {" · "}
                <Link href={`/crm/leads/${conversation.lead.id}`} className="text-primary hover:underline">
                  Lead: {conversation.lead.name}
                </Link>
              </>
            )}
          </p>
        </div>
        {(canManage || canReply) && (
          <Select value={conversation.assignee_id ?? "__sem__"} onValueChange={(v) => run(() => assignConversation({ id: conversation.id, assigneeId: v === "__sem__" ? null : v }))}>
            <SelectTrigger className="w-44" aria-label="Responsável pelo atendimento">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__sem__">Sem responsável</SelectItem>
              {owners.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.full_name || o.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {canReply && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => run(() => setConversationStatus({ id: conversation.id, status: conversation.status === "aberta" ? "encerrada" : "aberta", outcome: "" }))}
          >
            {conversation.status === "aberta" ? "Encerrar" : "Reabrir"}
          </Button>
        )}
        {!conversation.lead && canCreateLead && <CreateLeadDialog conversationId={conversation.id} defaultName={conversation.contact_name} pipelines={pipelines} />}
      </header>
      {conversation.origin && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/30 px-3 py-2 text-xs">
          <Megaphone className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">{conversation.origin.kind === "post" ? "Veio de uma publicação:" : "Veio de um anúncio:"}</span>
          {conversation.origin.campaignId ? (
            <Link href={`/anuncios/campanhas/${conversation.origin.campaignId}`} className="min-w-0 font-medium break-words text-primary hover:underline">
              {conversation.origin.title}
            </Link>
          ) : (
            <span className="min-w-0 font-medium break-words">{conversation.origin.title}</span>
          )}
          {conversation.origin.campaignName && <span className="min-w-0 break-words text-muted-foreground">Campanha {conversation.origin.campaignName}</span>}
          <span className="text-muted-foreground">em {formatDateTime(conversation.origin.at)}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <TagPicker
          value={tagIds}
          options={tags}
          disabled={!canReply || pending}
          onChange={(ids) => {
            setTagIds(ids);
            run(() => setConversationTags({ id: conversation.id, tagIds: ids }));
          }}
        />
      </div>

      <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-muted/30 p-3" aria-label="Mensagens">
        {conversation.messages.length === 0 && <li className="text-center text-sm text-muted-foreground">Nenhuma mensagem ainda.</li>}
        {conversation.messages.map((m) => {
          const st = STATUS_ICON[m.status];
          if (m.direction === "nota") {
            return (
              <li key={m.id} className="mx-auto w-full max-w-lg rounded-lg border border-dashed border-warning/60 bg-warning-soft px-3 py-2 text-sm">
                <p className="mb-0.5 flex items-center gap-1 text-xs font-medium text-warning">
                  <Lock className="size-3" aria-hidden="true" /> Observação interna · {names[m.author_id ?? ""] ?? "Equipe"} · {formatDateTime(m.created_at)}
                </p>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </li>
            );
          }
          const mine = m.direction === "saida";
          return (
            <li key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div className={cn("group max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-xs sm:max-w-[70%]", mine ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-surface")}>
                {m.media_id && (
                  <p className="mb-1">
                    {m.media_mime?.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element -- mídia privada servida pela rota autenticada
                      <img src={`/api/whatsapp/media/${m.id}`} alt={m.body || "Imagem recebida"} className="max-h-64 rounded-lg" loading="lazy" />
                    ) : m.media_mime?.startsWith("audio/") ? (
                      <audio controls src={`/api/whatsapp/media/${m.id}`} className="max-w-full" />
                    ) : (
                      <a href={`/api/whatsapp/media/${m.id}`} className="inline-flex items-center gap-1 underline">
                        <FileText className="size-4" aria-hidden="true" /> {m.media_name || "Abrir arquivo"}
                      </a>
                    )}
                  </p>
                )}
                {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                {!m.body && !m.media_id && <p className="italic opacity-80">[{m.type === "unsupported" ? "conteúdo não suportado" : m.type}]</p>}
                <p className={cn("mt-1 flex items-center justify-end gap-1 text-[11px]", mine ? "text-primary-foreground/80" : "text-muted-foreground")}>
                  {m.type === "template" && "Modelo · "}
                  {mine && m.author_id && names[m.author_id] ? `${names[m.author_id]} · ` : ""}
                  {time(m.created_at)}
                  {mine && st && <st.icon className={cn("size-3.5", m.status === "lida" && "text-sky-200", m.status === "erro" && "text-red-200")} aria-label={st.label} />}
                  <button
                    type="button"
                    onClick={() => run(() => toggleImportant({ id: m.id, important: !m.important }))}
                    aria-pressed={m.important}
                    aria-label={m.important ? "Desmarcar como importante" : "Marcar como importante"}
                    className={cn("rounded", m.important ? "opacity-100" : "opacity-0 group-hover:opacity-70 focus-visible:opacity-100")}
                  >
                    <Star className={cn("size-3.5", m.important && "fill-current")} aria-hidden="true" />
                  </button>
                </p>
                {m.status === "erro" && m.error && <p className="mt-1 text-[11px] text-red-100">{m.error}</p>}
              </div>
            </li>
          );
        })}
        <div ref={bottom} />
      </ol>

      {canReply && (
        <footer className="grid gap-2 border-t p-3">
          {blocked && (
            <p role="alert" className="flex items-center gap-2 text-sm text-danger">
              <Ban className="size-4" aria-hidden="true" /> Este contato pediu para não receber mensagens. Envios bloqueados; notas internas continuam liberadas.
            </p>
          )}
          {!windowOpen && !blocked && mode === "cliente" && (
            <p className="text-sm text-warning">Mais de 24 horas desde a última mensagem do cliente: só é possível enviar um modelo aprovado.</p>
          )}
          <div className="flex items-center gap-1" role="tablist" aria-label="Tipo de mensagem">
            <Button type="button" role="tab" aria-selected={mode === "cliente"} size="xs" variant={mode === "cliente" ? "default" : "ghost"} onClick={() => setMode("cliente")}>
              Para o cliente
            </Button>
            <Button type="button" role="tab" aria-selected={mode === "nota"} size="xs" variant={mode === "nota" ? "default" : "ghost"} onClick={() => setMode("nota")}>
              <Lock aria-hidden="true" /> Observação interna
            </Button>
            {approved.length > 0 && !blocked && <TemplateDialog conversationId={conversation.id} templates={approved} />}
          </div>
          <div className="flex items-end gap-2">
            <Textarea
              rows={2}
              value={text}
              maxLength={4096}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={mode === "nota" ? "Visível só para a equipe…" : "Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)"}
              aria-label={mode === "nota" ? "Observação interna" : "Mensagem para o cliente"}
              disabled={mode === "cliente" && (blocked || !windowOpen)}
              className={cn(mode === "nota" && "border-warning/60 bg-warning-soft/40")}
            />
            <Button onClick={send} disabled={pending || !text.trim() || (mode === "cliente" && (blocked || !windowOpen))} aria-label="Enviar">
              {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
            </Button>
          </div>
        </footer>
      )}
    </section>
  );
}

function TemplateDialog({ conversationId, templates }: { conversationId: string; templates: Template[] }) {
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

function CreateLeadDialog({ conversationId, defaultName, pipelines }: { conversationId: string; defaultName: string; pipelines: { id: string; name: string }[] }) {
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
