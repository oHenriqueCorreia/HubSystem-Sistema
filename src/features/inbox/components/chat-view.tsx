"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, Ban, Check, CheckCheck, ChevronDown, Clock, CornerUpLeft, FileText, Info, Lock, Megaphone, Paperclip, RefreshCw, Search, Send, Smile, Star, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatDateTime, todayLocal } from "@/domain/shared/dates";
import { formatPhone } from "@/domain/shared/phone";
import { avatarColor, chatInitials, chatTime, EMOJIS, groupMessagesByDay, messagePreview } from "@/domain/whatsapp/chat";
import { baseMime } from "@/domain/whatsapp/media";
import { fillQuickReply, matchQuickReplies, shortcutQuery, type QuickReply } from "@/domain/whatsapp/quick-replies";
import { createClient } from "@/lib/supabase/client";
import { TagPicker } from "@/features/tags/components/tag-picker";
import type { Tag } from "@/features/crm/types";
import { addInternalNote, assignConversation, markConversationRead, prepareWhatsAppUpload, sendWhatsAppMedia, sendWhatsAppMessage, setConversationStatus, setConversationTags, toggleImportant } from "../actions";
import type { ConversationOrigin, Message } from "../queries";
import { AttachButton, AudioRecorder, QuickReplyMenu } from "./composer-tools";
import { CloseDialog, CreateLeadDialog, TemplateDialog } from "./conversation-dialogs";

type Owner = { id: string; full_name: string; email: string };
type Template = { id: string; name: string; language: string; status: string; components: { type: string; text?: string }[] };
type Conversation = {
  id: string;
  contact_e164: string;
  contact_name: string;
  status: string;
  assignee_id: string | null;
  last_inbound_at: string | null;
  lead: { id: string; name: string; company_name?: string | null; contact_opt_out_at: string | null } | null;
  tagIds: string[];
  messages: Message[];
  origin: ConversationOrigin | null;
};
type Pending = { clientRef: string; body: string; at: string; failed: boolean; replyToId: string | null };

export function ChatAvatar({ name, seed, className }: { name: string; seed: string; className?: string }) {
  const letters = chatInitials(name);
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-full font-semibold text-white select-none", className ?? "size-10 text-sm")} style={{ background: avatarColor(seed) }} aria-hidden="true">
      {letters || (
        <svg viewBox="0 0 24 24" className="size-3/5 fill-current">
          <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9m0 2c-4 0-8 2-8 5v2h16v-2c0-3-4-5-8-5" />
        </svg>
      )}
    </span>
  );
}

function Ticks({ status }: { status: string }) {
  if (status === "enviando") return <Clock className="size-3.5" aria-label="Enviando" />;
  if (status === "erro") return <TriangleAlert className="size-3.5 text-danger" aria-label="Erro no envio" />;
  if (status === "lida") return <CheckCheck className="size-4 text-[#53bdeb]" aria-label="Lida" />;
  if (status === "entregue") return <CheckCheck className="size-4" aria-label="Entregue" />;
  return <Check className="size-4" aria-label="Enviada" />;
}

function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const at = text.toLowerCase().indexOf(term.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-warning/40 text-inherit">{text.slice(at, at + term.length)}</mark>
      {text.slice(at + term.length)}
    </>
  );
}

export function ChatView({
  conversation,
  owners,
  templates,
  tags,
  pipelines,
  names,
  canReply,
  canManage,
  canCreateLead,
  provider,
  online,
  quickReplies,
  leadPanel,
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
  provider: "cloud" | "waha";
  online: boolean;
  quickReplies: QuickReply[];
  leadPanel?: React.ReactNode;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [noteMode, setNoteMode] = useState(false);
  const [tagIds, setTagIds] = useState(conversation.tagIds);
  const [pending, setPending] = useState<Pending[]>([]);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [activeReply, setActiveReply] = useState(0);
  const [replyMenuClosed, setReplyMenuClosed] = useState(false);
  const [searching, setSearching] = useState(false);
  const [term, setTerm] = useState("");
  const [info, setInfo] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [busy, startTransition] = useTransition();
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [now] = useState(() => Date.now());
  const today = todayLocal();

  const display = conversation.contact_name || formatPhone(conversation.contact_e164);
  // A janela de 24 horas e os modelos são regras da API oficial; o QR Code só precisa estar conectado.
  const qr = provider === "waha";
  const windowOpen = qr || Boolean(conversation.last_inbound_at && now - new Date(conversation.last_inbound_at).getTime() < 24 * 3600_000);
  const blocked = Boolean(conversation.lead?.contact_opt_out_at);
  const offline = qr && !online;
  const canSend = !blocked && windowOpen && !offline;
  const approved = useMemo(() => (qr ? [] : templates.filter((t) => t.status === "APPROVED")), [qr, templates]);
  const query = !noteMode && !replyMenuClosed ? shortcutQuery(text) : null;
  const matches = useMemo(() => (query === null ? [] : matchQuickReplies(quickReplies, query)), [query, quickReplies]);
  const byWamid = useMemo(() => new Map(conversation.messages.filter((m) => m.wamid).map((m) => [m.wamid!, m])), [conversation.messages]);

  // Enviada confirmada pelo servidor sai da lista local: quem aparece é a mensagem real.
  const refs = useMemo(() => new Set(conversation.messages.map((m) => m.client_ref).filter(Boolean)), [conversation.messages]);
  const visiblePending = pending.filter((p) => !refs.has(p.clientRef));

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return conversation.messages;
    return conversation.messages.filter((m) => (m.body ?? "").toLowerCase().includes(q) || (m.media_name ?? "").toLowerCase().includes(q));
  }, [conversation.messages, term]);
  const groups = useMemo(() => groupMessagesByDay(filtered, today), [filtered, today]);

  const toBottom = (smooth = false) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setUnseen(0);
  };

  // Abre no fim; depois só desce sozinho se a pessoa já estava no fim.
  const lastCount = useRef(0);
  const lastId = conversation.messages.at(-1)?.id;
  useEffect(() => {
    const total = conversation.messages.length + visiblePending.length;
    const grew = total > lastCount.current;
    const first = lastCount.current === 0;
    const added = total - lastCount.current;
    lastCount.current = total;
    if (!grew) return;
    if (first || atBottom) toBottom(!first);
    else setUnseen((n) => n + added);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reage à chegada de mensagens
  }, [conversation.messages.length, visiblePending.length]);

  const lastInbound = conversation.messages.filter((m) => m.direction === "entrada").at(-1)?.id;
  useEffect(() => {
    void markConversationRead({ id: conversation.id });
  }, [conversation.id, lastInbound]);
  void lastId;

  // Campo cresce com o texto, como no WhatsApp.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [text]);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.message);
      if (res.message) toast.success(res.message);
      after?.();
      router.refresh();
    });
  }

  function chooseReply(reply: QuickReply) {
    setText(fillQuickReply(reply.body, { name: conversation.lead?.name ?? conversation.contact_name, company: conversation.lead?.company_name }));
    setActiveReply(0);
    setReplyMenuClosed(true);
    input.current?.focus();
  }

  async function deliver(p: Pending) {
    const res = await sendWhatsAppMessage({ conversationId: conversation.id, clientRef: p.clientRef, body: p.body, replyToId: p.replyToId }).catch(() => null);
    if (!res?.ok) {
      setPending((list) => list.map((x) => (x.clientRef === p.clientRef ? { ...x, failed: true } : x)));
      toast.error(res?.message ?? "Sem conexão. Toque em tentar de novo.");
    }
    router.refresh();
  }

  async function sendFile(blob: Blob, name: string, mime: string, caption: string) {
    setUploading(true);
    try {
      const prepared = await prepareWhatsAppUpload({ conversationId: conversation.id, mime, size: blob.size });
      if (!prepared.ok) return void toast.error(prepared.message);
      const { error } = await createClient().storage.from("whatsapp-media").uploadToSignedUrl(prepared.data.path, prepared.data.token, blob, { contentType: baseMime(mime) });
      if (error) return void toast.error("Não foi possível enviar o arquivo. Confira a conexão e tente de novo.");
      const res = await sendWhatsAppMedia({ conversationId: conversation.id, clientRef: crypto.randomUUID(), path: prepared.data.path, mime, size: blob.size, name, caption });
      if (!res.ok) toast.error(res.message);
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  function send() {
    const body = text.trim();
    if (file && !noteMode) {
      const f = file;
      setFile(null);
      setText("");
      void sendFile(f, f.name, f.type, body);
      return;
    }
    if (!body) return;
    if (noteMode) return run(() => addInternalNote({ conversationId: conversation.id, body }), () => setText(""));
    // A mensagem aparece na hora; o clientRef evita enviar duas vezes.
    const p: Pending = { clientRef: crypto.randomUUID(), body, at: new Date().toISOString(), failed: false, replyToId: replyTo?.id ?? null };
    setPending((list) => [...list, p]);
    setText("");
    setReplyTo(null);
    setReplyMenuClosed(false);
    setAtBottom(true);
    void deliver(p);
    input.current?.focus();
  }

  function pickFile(f: File | undefined | null) {
    if (!f || !canSend || noteMode) return;
    setFile(f);
    input.current?.focus();
  }

  const composerDisabled = !noteMode && !canSend;
  const showSend = Boolean(text.trim() || (file && !noteMode));

  return (
    <section
      aria-label={`Conversa com ${display}`}
      className="relative flex h-full min-h-0 flex-col bg-[var(--chat-wallpaper)]"
      onDragOver={(e) => {
        if (!canReply || composerDisabled) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        pickFile(e.dataTransfer.files[0]);
      }}
    >
      <header className="flex items-center gap-2 border-b bg-[var(--chat-panel)] px-2 py-2 sm:px-3">
        <Button asChild variant="ghost" size="icon-sm" className="md:hidden">
          <Link href="/atendimento" aria-label="Voltar para a lista">
            <ArrowLeft aria-hidden="true" />
          </Link>
        </Button>
        <button type="button" onClick={() => setInfo(true)} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left" aria-label={`Dados de ${display}`}>
          <ChatAvatar name={conversation.contact_name} seed={conversation.contact_e164} />
          <span className="grid min-w-0">
            <span className="truncate font-semibold">{display}</span>
            <span className="truncate text-xs text-muted-foreground">
              {conversation.status === "encerrada" ? "Atendimento encerrado" : conversation.lead ? conversation.lead.name : formatPhone(conversation.contact_e164)}
            </span>
          </span>
        </button>
        <Button variant="ghost" size="icon-sm" aria-label="Pesquisar na conversa" aria-pressed={searching} onClick={() => { setSearching((v) => !v); setTerm(""); }}>
          <Search aria-hidden="true" />
        </Button>
        <span className="hidden sm:contents">{leadPanel}</span>
        {canReply &&
          (conversation.status === "aberta" ? (
            <CloseDialog conversationId={conversation.id} />
          ) : (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => setConversationStatus({ id: conversation.id, status: "aberta", outcome: "" }))}>
              Reabrir
            </Button>
          ))}
        <Button variant="ghost" size="icon-sm" aria-label="Dados do contato" onClick={() => setInfo(true)}>
          <Info aria-hidden="true" />
        </Button>
      </header>

      {searching && (
        <div className="flex items-center gap-2 border-b bg-[var(--chat-panel)] px-3 py-2">
          <Input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Pesquisar mensagens…" aria-label="Pesquisar mensagens" />
          <span className="text-xs whitespace-nowrap text-muted-foreground tabular" aria-live="polite">
            {term.trim() ? `${filtered.length} encontrada(s)` : ""}
          </span>
        </div>
      )}

      {conversation.origin && (
        <p className="flex flex-wrap items-center gap-x-2 border-b bg-[var(--chat-panel)] px-3 py-1.5 text-xs">
          <Megaphone className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">{conversation.origin.kind === "post" ? "Veio de uma publicação:" : "Veio de um anúncio:"}</span>
          {conversation.origin.campaignId ? (
            <Link href={`/anuncios/campanhas/${conversation.origin.campaignId}`} className="min-w-0 font-medium break-words text-primary hover:underline">
              {conversation.origin.title}
            </Link>
          ) : (
            <span className="min-w-0 font-medium break-words">{conversation.origin.title}</span>
          )}
        </p>
      )}

      <div
        ref={scroller}
        role="log"
        aria-label="Mensagens"
        onScroll={(e) => {
          const el = e.currentTarget;
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          setAtBottom(bottom);
          if (bottom) setUnseen(0);
        }}
        className="chat-wallpaper min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-[6%]"
      >
        {groups.length === 0 && visiblePending.length === 0 && (
          <p className="mx-auto mt-6 w-fit rounded-lg bg-[var(--chat-pill)] px-3 py-1.5 text-center text-xs text-muted-foreground shadow-xs">{term ? "Nenhuma mensagem encontrada." : "Nenhuma mensagem ainda. Diga olá."}</p>
        )}
        {groups.map((g) => (
          <div key={g.day} className="grid gap-1">
            <p className="sticky top-1 z-10 mx-auto my-2 w-fit rounded-lg bg-[var(--chat-pill)] px-3 py-1 text-xs text-muted-foreground shadow-xs first-letter:uppercase">{g.label}</p>
            {g.items.map((m, i) => {
              if (m.direction === "nota") {
                return (
                  <div key={m.id} className="mx-auto my-1 w-full max-w-lg rounded-lg border border-dashed border-warning/60 bg-warning-soft px-3 py-2 text-sm">
                    <p className="mb-0.5 flex flex-wrap items-center gap-1 text-xs font-medium text-warning">
                      <Lock className="size-3" aria-hidden="true" /> Observação interna, só a equipe vê. {names[m.author_id ?? ""] ?? "Equipe"}, {chatTime(m.created_at)}
                    </p>
                    <p className="break-words whitespace-pre-wrap">
                      <Highlight text={m.body ?? ""} term={term.trim()} />
                    </p>
                  </div>
                );
              }
              const mine = m.direction === "saida";
              const firstOfRun = g.items[i - 1]?.direction !== m.direction;
              const quoted = m.reply_to_wamid ? byWamid.get(m.reply_to_wamid) : null;
              const media = `/api/whatsapp/media/${m.id}`;
              return (
                <div key={m.id} className={cn("group flex items-center gap-1", mine ? "justify-end" : "justify-start", firstOfRun && "mt-1.5")}>
                  {mine && canReply && <BubbleMenu message={m} onReply={() => { setReplyTo(m); input.current?.focus(); }} onStar={() => run(() => toggleImportant({ id: m.id, important: !m.important }))} />}
                  <div className={cn("chat-bubble relative max-w-[85%] rounded-lg px-2 pt-1.5 pb-1 text-sm shadow-xs sm:max-w-[65%]", mine ? "bg-[var(--chat-out)]" : "bg-[var(--chat-in)]", firstOfRun && (mine ? "rounded-tr-none chat-tail-out" : "rounded-tl-none chat-tail-in"))}>
                    {m.reply_to_wamid && (
                      <div className="mb-1 rounded border-l-4 border-[#06cf9c] bg-black/5 px-2 py-1 text-xs dark:bg-white/10">
                        <p className="font-semibold text-[#06a57f]">{quoted ? (quoted.direction === "saida" ? "Você" : display) : "Mensagem citada"}</p>
                        <p className="line-clamp-2 break-words opacity-80">{quoted ? messagePreview(quoted) : "Mensagem anterior"}</p>
                      </div>
                    )}
                    {m.media_id && (
                      <div className="mb-1">
                        {m.media_mime?.startsWith("image/") ? (
                          <button type="button" className="block" aria-label="Ampliar imagem" onClick={() => setLightbox({ src: media, alt: m.body || "Imagem da conversa" })}>
                            {/* eslint-disable-next-line @next/next/no-img-element -- mídia privada servida pela rota autenticada */}
                            <img src={media} alt={m.body || "Imagem da conversa"} width={320} height={320} className="max-h-72 w-auto max-w-full rounded-md object-cover" loading="lazy" />
                          </button>
                        ) : m.media_mime?.startsWith("audio/") ? (
                          <audio controls preload="metadata" src={media} className="h-10 max-w-full min-w-56" />
                        ) : m.media_mime?.startsWith("video/") ? (
                          <video controls preload="metadata" src={media} className="max-h-72 max-w-full rounded-md" />
                        ) : (
                          <a href={media} className="flex items-center gap-2 rounded-md bg-black/5 px-2 py-2 hover:bg-black/10 dark:bg-white/10">
                            <FileText className="size-6 shrink-0 text-danger" aria-hidden="true" />
                            <span className="min-w-0 truncate underline-offset-2 hover:underline">{m.media_name || "Abrir arquivo"}</span>
                          </a>
                        )}
                      </div>
                    )}
                    <div className="break-words whitespace-pre-wrap">
                      {m.body ? <Highlight text={m.body} term={term.trim()} /> : !m.media_id ? <span className="italic opacity-70">{m.type === "unsupported" ? "Conteúdo não suportado" : messagePreview(m)}</span> : null}
                      {/* Espaço reservado para a hora não cobrir o texto. */}
                      <span className="inline-block w-16 sm:w-20" aria-hidden="true" />
                    </div>
                    <p className="float-right -mt-3.5 ml-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                      {m.important && <Star className="size-3 fill-current" aria-label="Importante" />}
                      {m.type === "template" && <span>Modelo</span>}
                      {mine && m.author_id && names[m.author_id] && <span className="max-w-24 truncate">{names[m.author_id].split(" ")[0]}</span>}
                      <span className="tabular">{chatTime(m.created_at)}</span>
                      {mine && <Ticks status={m.status} />}
                    </p>
                    {m.status === "erro" && m.error && <p className="clear-both mt-1 text-[11px] break-words text-danger">{m.error}</p>}
                  </div>
                  {!mine && canReply && <BubbleMenu message={m} onReply={() => { setReplyTo(m); input.current?.focus(); }} onStar={() => run(() => toggleImportant({ id: m.id, important: !m.important }))} />}
                </div>
              );
            })}
          </div>
        ))}
        {visiblePending.map((p) => (
          <div key={p.clientRef} className="mt-1 flex justify-end">
            <div className={cn("relative max-w-[85%] rounded-lg bg-[var(--chat-out)] px-2 pt-1.5 pb-1 text-sm shadow-xs sm:max-w-[65%]", p.failed && "ring-1 ring-danger")}>
              <div className="break-words whitespace-pre-wrap">
                {p.body}
                <span className="inline-block w-14" aria-hidden="true" />
              </div>
              <p className="float-right -mt-3.5 ml-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                <span className="tabular">{chatTime(p.at)}</span>
                <Ticks status={p.failed ? "erro" : "enviando"} />
              </p>
              {p.failed && (
                <div className="clear-both mt-1 flex items-center gap-2 text-[11px]">
                  <span className="text-danger">Não enviada.</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-medium underline"
                    onClick={() => {
                      const again = { ...p, failed: false };
                      setPending((l) => l.map((x) => (x.clientRef === p.clientRef ? again : x)));
                      void deliver(again);
                    }}
                  >
                    <RefreshCw className="size-3" aria-hidden="true" /> Tentar de novo
                  </button>
                  <button type="button" className="underline" onClick={() => setPending((l) => l.filter((x) => x.clientRef !== p.clientRef))}>
                    Descartar
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {uploading && (
          <div className="mt-1 flex justify-end" role="status">
            <div className="rounded-lg bg-[var(--chat-out)] px-3 py-2 text-xs text-muted-foreground shadow-xs">Enviando arquivo…</div>
          </div>
        )}
      </div>

      {!atBottom && (
        <button type="button" onClick={() => toBottom(true)} aria-label={unseen ? `Ir para ${unseen} mensagem(ns) nova(s)` : "Ir para o fim"} className="absolute right-4 bottom-24 z-10 grid size-10 place-items-center rounded-full bg-[var(--chat-panel)] text-muted-foreground shadow-md hover:text-foreground">
          <ArrowDown className="size-5" aria-hidden="true" />
          {unseen > 0 && <span className="absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full bg-[#00a884] px-1 text-[11px] font-semibold text-white tabular">{unseen}</span>}
        </button>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-background/80" aria-hidden="true">
          <p className="rounded-xl border-2 border-dashed border-[#00a884] px-6 py-4 font-medium">Solte para anexar</p>
        </div>
      )}

      {canReply && (
        <footer className="grid gap-1.5 bg-[var(--chat-panel)] px-2 py-2 sm:px-3">
          {blocked && (
            <p role="alert" className="flex items-center gap-2 text-sm text-danger">
              <Ban className="size-4 shrink-0" aria-hidden="true" /> Este contato pediu para não receber mensagens. Envios bloqueados; observações internas continuam liberadas.
            </p>
          )}
          {!windowOpen && !blocked && !noteMode && <p className="text-sm text-warning">Mais de 24 horas desde a última mensagem do cliente: só é possível enviar um modelo aprovado.</p>}
          {offline && !blocked && !noteMode && <p className="text-sm text-warning">Este WhatsApp está desconectado. Reconecte em Números para enviar.</p>}

          {matches.length > 0 && <QuickReplyMenu id="respostas-rapidas" replies={matches} active={activeReply} onChoose={chooseReply} />}

          {replyTo && (
            <div className="flex items-center gap-2 rounded-lg bg-black/5 py-1 pr-1 pl-2 dark:bg-white/10">
              <div className="min-w-0 flex-1 border-l-4 border-[#06cf9c] pl-2 text-xs">
                <p className="font-semibold text-[#06a57f]">{replyTo.direction === "saida" ? "Você" : display}</p>
                <p className="truncate opacity-80">{messagePreview(replyTo)}</p>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancelar citação" onClick={() => setReplyTo(null)}>
                <X aria-hidden="true" />
              </Button>
            </div>
          )}
          {file && !noteMode && (
            <p className="flex items-center gap-2 rounded-lg bg-black/5 px-2 py-1 text-sm dark:bg-white/10">
              <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Remover anexo" onClick={() => setFile(null)}>
                <X aria-hidden="true" />
              </Button>
            </p>
          )}

          <div className="flex items-end gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="ghost" size="icon" aria-label="Emojis" disabled={composerDisabled}>
                  <Smile aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="grid w-72 grid-cols-8 gap-0.5 p-2" align="start">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    aria-label={`Inserir ${e}`}
                    className="grid size-8 place-items-center rounded text-lg hover:bg-accent"
                    onClick={() => {
                      setText((t) => t + e);
                      input.current?.focus();
                    }}
                  >
                    {e}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            {!noteMode && <AttachButton disabled={!canSend || uploading} onPick={pickFile} />}
            <Button type="button" variant={noteMode ? "secondary" : "ghost"} size="icon" aria-pressed={noteMode} aria-label={noteMode ? "Voltar a escrever para o cliente" : "Escrever observação interna"} title="Observação interna" onClick={() => setNoteMode((v) => !v)}>
              <Lock className={cn(noteMode && "text-warning")} aria-hidden="true" />
            </Button>
            {approved.length > 0 && !blocked && !noteMode && <TemplateDialog conversationId={conversation.id} templates={approved} />}
            <textarea
              ref={input}
              rows={1}
              value={text}
              maxLength={4096}
              disabled={composerDisabled}
              role={matches.length > 0 ? "combobox" : undefined}
              aria-expanded={matches.length > 0 ? true : undefined}
              aria-controls={matches.length > 0 ? "respostas-rapidas" : undefined}
              aria-activedescendant={matches.length > 0 ? `respostas-rapidas-${activeReply}` : undefined}
              aria-label={noteMode ? "Observação interna" : "Mensagem para o cliente"}
              placeholder={noteMode ? "Observação só para a equipe…" : file ? "Legenda (opcional)…" : "Digite uma mensagem ou / para respostas…"}
              onChange={(e) => {
                setText(e.target.value);
                setActiveReply(0);
                setReplyMenuClosed(false);
              }}
              onPaste={(e) => {
                const image = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
                if (image) {
                  e.preventDefault();
                  pickFile(image);
                }
              }}
              onKeyDown={(e) => {
                if (matches.length > 0) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const step = e.key === "ArrowDown" ? 1 : -1;
                    return setActiveReply((i) => (i + step + matches.length) % matches.length);
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    return chooseReply(matches[Math.min(activeReply, matches.length - 1)]);
                  }
                  if (e.key === "Escape") return setReplyMenuClosed(true);
                }
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              className={cn("max-h-36 min-h-10 min-w-0 flex-1 resize-none rounded-lg border-0 bg-[var(--chat-input)] px-3 py-2.5 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 md:text-sm", noteMode && "bg-warning-soft")}
            />
            {showSend || noteMode ? (
              <button type="button" onClick={send} disabled={!showSend || (composerDisabled && !noteMode)} aria-label="Enviar" className="grid size-10 shrink-0 place-items-center rounded-full bg-[#00a884] text-white transition-colors hover:bg-[#008f72] disabled:opacity-50">
                <Send className="size-5" aria-hidden="true" />
              </button>
            ) : (
              <AudioRecorder disabled={!canSend || uploading} onRecorded={(blob, mime) => void sendFile(blob, `audio.${baseMime(mime).split("/")[1]}`, mime, "")} />
            )}
          </div>
        </footer>
      )}

      <Dialog open={Boolean(lightbox)} onOpenChange={(v) => !v && setLightbox(null)}>
        <DialogContent className="grid max-w-[95vw] place-items-center bg-black/95 p-2 sm:max-w-[90vw]">
          <DialogTitle className="sr-only">Imagem da conversa</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element -- mídia privada servida pela rota autenticada */}
          {lightbox && <img src={lightbox.src} alt={lightbox.alt} className="max-h-[85dvh] max-w-full object-contain" />}
        </DialogContent>
      </Dialog>

      <Sheet open={info} onOpenChange={setInfo}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="sr-only">Dados do contato</SheetTitle>
            <SheetDescription className="sr-only">Responsável, etiquetas e lead da conversa.</SheetDescription>
          </SheetHeader>
          <div className="grid justify-items-center gap-2 px-4 pb-2 text-center">
            <ChatAvatar name={conversation.contact_name} seed={conversation.contact_e164} className="size-24 text-3xl" />
            <p className="text-lg font-semibold break-words">{display}</p>
            <p className="text-sm text-muted-foreground tabular">{formatPhone(conversation.contact_e164)}</p>
          </div>
          <div className="grid gap-5 px-4 pb-6 text-sm">
            <div className="flex flex-wrap justify-center gap-2">
              {conversation.lead && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/crm/leads/${conversation.lead.id}`}>Abrir lead</Link>
                </Button>
              )}
              <span className="sm:hidden">{leadPanel}</span>
              {!conversation.lead && canCreateLead && <CreateLeadDialog conversationId={conversation.id} defaultName={conversation.contact_name} pipelines={pipelines} />}
            </div>
            {(canManage || canReply) && (
              <div className="grid gap-1.5">
                <label htmlFor="chat-responsavel" className="font-medium">
                  Responsável
                </label>
                <Select value={conversation.assignee_id ?? "__sem__"} onValueChange={(v) => run(() => assignConversation({ id: conversation.id, assigneeId: v === "__sem__" ? null : v }))}>
                  <SelectTrigger id="chat-responsavel" className="w-full">
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
              </div>
            )}
            <div className="grid gap-1.5">
              <p className="font-medium">Etiquetas</p>
              <TagPicker
                value={tagIds}
                options={tags}
                disabled={!canReply || busy}
                onChange={(ids) => {
                  setTagIds(ids);
                  run(() => setConversationTags({ id: conversation.id, tagIds: ids }));
                }}
              />
            </div>
            {conversation.origin && (
              <div className="grid gap-0.5">
                <p className="font-medium">Origem</p>
                <p className="break-words text-muted-foreground">
                  {conversation.origin.title}, em {formatDateTime(conversation.origin.at)}
                </p>
              </div>
            )}
            {conversation.messages.some((m) => m.important) && (
              <div className="grid gap-1">
                <p className="font-medium">Mensagens importantes</p>
                <ul className="grid gap-1">
                  {conversation.messages
                    .filter((m) => m.important)
                    .slice(-10)
                    .map((m) => (
                      <li key={m.id} className="rounded-md border px-2 py-1 text-xs break-words">
                        {messagePreview(m)}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}

function BubbleMenu({ message, onReply, onStar }: { message: Message; onReply: () => void; onStar: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Opções da mensagem" className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--chat-pill)] text-muted-foreground opacity-0 shadow-xs transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 max-md:opacity-60">
          <ChevronDown className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        <DropdownMenuItem onSelect={onReply}>
          <CornerUpLeft aria-hidden="true" /> Responder
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onStar}>
          <Star aria-hidden="true" /> {message.important ? "Desmarcar importante" : "Marcar importante"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
