"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Clapperboard, Copy, ExternalLink, Heart, Image as ImageIcon, LoaderCircle, MessageCircle, Plus, Send, Settings2, ThumbsUp, Upload, Video, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormAlert, FormField } from "@/components/app/form-field";
import { dayKey, minutesOfDay } from "@/domain/calendar";
import { addDays, listDays, monthRange } from "@/domain/calendar/agenda";
import { FORMAT_LABEL, formatProblem, IG_CAPTION_MAX, MAX_VIDEO_BYTES, PLATFORM_LABEL, publishProblem, SCHEDULE_STATUS_LABEL, VIDEO_TYPES, type ContentFormat } from "@/domain/content";
import { createClient } from "@/lib/supabase/client";
import { getWorkspaceOptions } from "@/features/tasks/actions";
import { addDriveVideo, approveInternally, createStudioDraft, prepareImageUpload, prepareVideoUpload, refreshSocialAccounts, registerImage, registerVideo, requestApproval, scheduleContent } from "../actions";
import type { ScheduleRow, SocialAccount } from "../queries";

const FORMAT_ICON = { post: ImageIcon, video: Video, reels: Clapperboard };
const NONE = "__nenhum__";

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
const hhmm = (iso: string) => {
  const m = minutesOfDay(iso);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const utc = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { ...o, timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

function FacebookMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path d="M16.2 15.2 16.8 12h-3.1V9.9c0-.9.4-1.7 1.8-1.7h1.4V5.5s-1.3-.2-2.5-.2c-2.5 0-4.2 1.5-4.2 4.3V12H7.3v3.2h2.9V24h3.5v-8.8z" fill="#fff" />
    </svg>
  );
}

function InstagramMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="ig-grad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#FEC053" />
          <stop offset=".5" stopColor="#F2203E" />
          <stop offset="1" stopColor="#5258CF" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="6.5" fill="url(#ig-grad)" />
      <rect x="5.5" y="5.5" width="13" height="13" rx="4" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.1" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="16.1" cy="7.9" r="1" fill="#fff" />
    </svg>
  );
}

export function PlatformMark({ platform, className }: { platform: string; className?: string }) {
  return platform === "instagram" ? <InstagramMark className={className} /> : <FacebookMark className={className} />;
}

/** Foto da conta com a marca da rede. Foto vencida ou ausente vira iniciais. */
export function AccountAvatar({ account, size = "md" }: { account: Pick<SocialAccount, "name" | "platform" | "picture_url">; size?: "sm" | "md" | "lg" }) {
  const [broken, setBroken] = useState(false);
  const box = size === "lg" ? "size-14 text-base" : size === "sm" ? "size-8 text-xs" : "size-10 text-sm";
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center rounded-full bg-accent font-semibold text-accent-foreground", box)}>
      {account.picture_url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- foto servida pela própria Meta
        <img src={account.picture_url} alt="" width={56} height={56} referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-full rounded-full object-cover" />
      ) : (
        initials(account.name)
      )}
      <PlatformMark platform={account.platform} className={cn("absolute -right-0.5 -bottom-0.5 rounded-full ring-2 ring-surface", size === "lg" ? "size-5" : "size-3.5")} />
    </span>
  );
}

type Stats = { agendados: number; publicados: number; erros: number; aguardando: number };

export function StudioHeader({ account, stats, children }: { account: SocialAccount | null; stats: Stats; children: React.ReactNode }) {
  const items = [
    { label: "Agendados", value: stats.agendados, tone: "text-info" },
    { label: "Publicados", value: stats.publicados, tone: "text-success" },
    { label: "Aguardando aprovação", value: stats.aguardando, tone: "text-warning" },
    { label: "Com erro", value: stats.erros, tone: stats.erros ? "text-danger" : "" },
  ];
  return (
    <div className="grid gap-4 rounded-2xl border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        {account ? <AccountAvatar account={account} size="lg" /> : <span className="grid size-14 place-items-center rounded-full bg-accent text-accent-foreground"><Send className="size-6" aria-hidden="true" /></span>}
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold break-words">{account ? account.name : "Todas as contas"}</h2>
          <p className="text-sm text-muted-foreground">{account ? (account.username ? `@${account.username} no ${PLATFORM_LABEL[account.platform]}` : PLATFORM_LABEL[account.platform]) : "Programação de todas as contas ativas"}</p>
        </div>
        <div className="flex flex-wrap gap-2">{children}</div>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {items.map((i) => (
          <div key={i.label} className="rounded-lg bg-muted/40 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{i.label}</dt>
            <dd className={cn("text-xl font-semibold tabular", i.tone)}>{i.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function AccountRail({ accounts, current, baseHref, needsRefresh }: { accounts: SocialAccount[]; current: string | null; baseHref: string; needsRefresh: boolean }) {
  const active = accounts.filter((a) => a.selected && a.status === "ativa");
  const broken = accounts.filter((a) => a.selected && a.status !== "ativa");
  useEffect(() => {
    if (needsRefresh) void refreshSocialAccounts({});
  }, [needsRefresh]);
  const item = "flex min-w-0 items-center gap-2.5 rounded-xl px-2 py-2 text-left text-sm transition-colors hover:bg-accent";
  return (
    <nav aria-label="Contas" className="flex gap-1 overflow-x-auto pb-1 lg:grid lg:content-start lg:overflow-visible lg:pb-0">
      <Link href={baseHref} aria-current={!current ? "page" : undefined} className={cn(item, "shrink-0", !current && "bg-accent font-medium")}>
        <span className="grid size-10 place-items-center rounded-full bg-primary text-primary-foreground">
          <Send className="size-4" aria-hidden="true" />
        </span>
        <span className="truncate">Todas</span>
      </Link>
      {active.map((a) => (
        <Link key={a.id} href={`${baseHref}${baseHref.includes("?") ? "&" : "?"}conta=${a.id}`} aria-current={current === a.id ? "page" : undefined} title={a.name} className={cn(item, "shrink-0 max-lg:max-w-44", current === a.id && "bg-accent font-medium")}>
          <AccountAvatar account={a} />
          <span className="grid min-w-0">
            <span className="truncate">{a.name}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">{a.username ? `@${a.username}` : PLATFORM_LABEL[a.platform]}</span>
          </span>
        </Link>
      ))}
      {broken.map((a) => (
        <Link key={a.id} href="/conteudo?aba=contas" title={`${a.name}: requer reconexão`} className={cn(item, "shrink-0 opacity-70 max-lg:max-w-44")}>
          <AccountAvatar account={a} />
          <span className="grid min-w-0">
            <span className="truncate">{a.name}</span>
            <span className="truncate text-xs text-danger">Reconectar</span>
          </span>
        </Link>
      ))}
      <Link href="/conteudo?aba=contas" className={cn(item, "shrink-0 text-muted-foreground")}>
        <span className="grid size-10 place-items-center rounded-full border border-dashed">
          <Settings2 className="size-4" aria-hidden="true" />
        </span>
        <span className="truncate">Gerenciar contas</span>
      </Link>
    </nav>
  );
}

const STATUS_STYLE: Record<string, string> = {
  agendado: "border-info/30 bg-info-soft text-info",
  publicando: "border-warning/30 bg-warning-soft text-warning",
  publicado: "border-success/30 bg-success-soft text-success",
  erro: "border-danger/40 bg-danger-soft text-danger",
};

export function Planner({ month, schedules, today, hrefBase, onCreate }: { month: string; schedules: ScheduleRow[]; today: string; hrefBase: string; onCreate?: React.ReactNode }) {
  const range = monthRange(`${month}-15`);
  const days = listDays(range.from, range.to);
  const prev = addDays(`${month}-01`, -1).slice(0, 7);
  const next = addDays(`${month}-28`, 7).slice(0, 7);
  const byDay = useMemo(() => {
    const out = new Map<string, ScheduleRow[]>();
    for (const s of schedules) out.set(dayKey(s.scheduled_at), [...(out.get(dayKey(s.scheduled_at)) ?? []), s]);
    return out;
  }, [schedules]);
  return (
    <section aria-label="Planejador" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-1">
        <Button asChild variant="ghost" size="icon-sm">
          <Link href={`${hrefBase}mes=${prev}`} aria-label="Mês anterior">
            <ChevronLeft aria-hidden="true" />
          </Link>
        </Button>
        <Button asChild variant="ghost" size="icon-sm">
          <Link href={`${hrefBase}mes=${next}`} aria-label="Próximo mês">
            <ChevronRight aria-hidden="true" />
          </Link>
        </Button>
        <h3 className="ml-1 font-semibold first-letter:uppercase">{utc(`${month}-15`, { month: "long", year: "numeric" })}</h3>
        <span className="ml-auto text-xs text-muted-foreground">Horário de Brasília</span>
        {onCreate}
      </div>
      <div className="hidden grid-cols-7 gap-1.5 text-center text-xs font-medium text-muted-foreground lg:grid" aria-hidden="true">
        {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <ol className="grid gap-1.5 lg:grid-cols-7">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const outside = d.slice(0, 7) !== month;
          return (
            <li key={d} className={cn("grid min-w-0 content-start gap-1 rounded-xl border bg-surface p-1.5 lg:min-h-32", outside && "bg-muted/30", d === today && "border-primary ring-1 ring-primary", !list.length && d !== today && "max-lg:hidden")}>
              <p className={cn("px-0.5 text-xs font-medium tabular", outside && "text-muted-foreground", d === today && "text-primary")}>
                <span className="lg:hidden first-letter:uppercase">{utc(d, { weekday: "long", day: "numeric", month: "short" })}</span>
                <span className="hidden lg:inline">{Number(d.slice(8))}</span>
              </p>
              {list.map((s) => {
                const Icon = FORMAT_ICON[s.format];
                return (
                  <Link key={s.id} href={`/conteudo/${s.content_id}`} title={`${s.title}: ${SCHEDULE_STATUS_LABEL[s.status] ?? s.status}`} className={cn("grid gap-1 overflow-hidden rounded-lg border p-1 text-xs transition-shadow hover:shadow-md", STATUS_STYLE[s.status] ?? "bg-muted")}>
                    {s.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element -- link assinado e temporário do armazenamento privado
                      <img src={s.thumb} alt="" width={160} height={100} loading="lazy" className="aspect-video w-full rounded object-cover" />
                    ) : (
                      <span className="grid aspect-video w-full place-items-center rounded bg-background/60">
                        <Icon className="size-5 opacity-70" aria-hidden="true" />
                      </span>
                    )}
                    <span className="flex min-w-0 items-center gap-1">
                      {s.account && <PlatformMark platform={s.account.platform} className="size-3.5 shrink-0" />}
                      <span className="tabular">{hhmm(s.scheduled_at)}</span>
                      <span className="truncate opacity-80">{FORMAT_LABEL[s.format]}</span>
                    </span>
                    <span className="line-clamp-2 font-medium break-words text-foreground">{s.title}</span>
                    <span className="truncate">{SCHEDULE_STATUS_LABEL[s.status] ?? s.status}</span>
                  </Link>
                );
              })}
            </li>
          );
        })}
      </ol>
      {schedules.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nada programado neste mês. Crie um post, vídeo ou reels para começar.</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------------
// Criar: formulário à esquerda e prévia no celular à direita
// ---------------------------------------------------------------------------------

/** O Instagram só aceita JPEG: toda imagem vira JPEG no navegador antes de subir. */
async function toJpeg(file: File): Promise<Blob> {
  if (file.type === "image/jpeg" && file.size <= 8 * 1024 * 1024) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2160 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("jpeg"))), "image/jpeg", 0.9));
}

function PhonePreview({ account, format, caption, images, video, driveUrl }: { account: SocialAccount | null; format: ContentFormat; caption: string; images: string[]; video: string | null; driveUrl: string }) {
  const name = account?.name ?? "Sua conta";
  const instagram = account?.platform === "instagram";
  const vertical = format === "reels";
  const media = video ? (
    <video src={video} muted loop autoPlay playsInline className={cn("w-full bg-black object-cover", vertical ? "aspect-[9/16]" : "aspect-video")} />
  ) : images.length ? (
    // eslint-disable-next-line @next/next/no-img-element -- prévia local do arquivo escolhido
    <img src={images[0]} alt="" className="aspect-square w-full object-cover" />
  ) : (
    <span className={cn("grid w-full place-items-center bg-muted text-xs text-muted-foreground", vertical ? "aspect-[9/16]" : "aspect-square")}>{driveUrl ? "Vídeo do Google Drive" : "Sua mídia aparece aqui"}</span>
  );
  const owner = (
    <div className="flex items-center gap-2 p-2.5">
      {account ? <AccountAvatar account={account} size="sm" /> : <span className="size-8 rounded-full bg-muted" />}
      <span className="grid min-w-0">
        <span className="truncate text-xs font-semibold">{name}</span>
        <span className="text-[10px] text-muted-foreground">{instagram ? "Instagram" : "Agora mesmo"}</span>
      </span>
    </div>
  );
  return (
    <div className="mx-auto w-full max-w-[17.5rem] rounded-[2rem] border-4 border-foreground/80 bg-surface p-1 shadow-lg" aria-label="Prévia da publicação">
      <div className="max-h-[32rem] overflow-y-auto rounded-[1.6rem] bg-surface">
        {instagram ? (
          <>
            {owner}
            {media}
            {images.length > 1 && <p className="pt-1 text-center text-[10px] text-muted-foreground tabular">1 de {images.length}</p>}
            <div className="flex gap-3 p-2.5 text-foreground">
              <Heart className="size-5" aria-hidden="true" />
              <MessageCircle className="size-5" aria-hidden="true" />
              <Send className="size-5" aria-hidden="true" />
            </div>
            <p className="px-2.5 pb-3 text-xs break-words whitespace-pre-wrap">
              <span className="font-semibold">{account?.username ?? name}</span> {caption || <span className="text-muted-foreground">Sua legenda aparece aqui</span>}
            </p>
          </>
        ) : (
          <>
            {owner}
            <p className="px-2.5 pb-2 text-xs break-words whitespace-pre-wrap">{caption || <span className="text-muted-foreground">Sua legenda aparece aqui</span>}</p>
            {media}
            {images.length > 1 && <p className="pt-1 text-center text-[10px] text-muted-foreground tabular">{images.length} fotos</p>}
            <div className="flex justify-around border-t p-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <ThumbsUp className="size-3.5" aria-hidden="true" /> Curtir
              </span>
              <span className="inline-flex items-center gap-1">
                <MessageCircle className="size-3.5" aria-hidden="true" /> Comentar
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Composer({ accounts, initialAccount, trigger, initialFormat = "post" }: { accounts: SocialAccount[]; initialAccount: string | null; trigger: React.ReactNode; initialFormat?: ContentFormat }) {
  const router = useRouter();
  const usable = useMemo(() => accounts.filter((a) => a.selected && a.status === "ativa"), [accounts]);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ContentFormat>(initialFormat);
  const [selected, setSelected] = useState<string[]>(initialAccount ? [initialAccount] : usable[0] ? [usable[0].id] : []);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [driveUrl, setDriveUrl] = useState("");
  const [clients, setClients] = useState<{ id: string; legal_name: string }[]>([]);
  const [clientId, setClientId] = useState(NONE);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState(false);
  const isVideo = format !== "post";
  const hasClient = clientId !== NONE;
  const previewAccount = usable.find((a) => a.id === previewId) ?? usable.find((a) => selected.includes(a.id)) ?? null;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void getWorkspaceOptions({}).then((res) => {
      if (alive && res.ok) setClients(res.data.clients);
    });
    return () => {
      alive = false;
    };
  }, [open]);

  // Prévias locais: o arquivo só sobe quando a pessoa confirma.
  useEffect(() => {
    const created = files.map((f) => URL.createObjectURL(f));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- links temporários acompanham os arquivos escolhidos
    setUrls(created);
    return () => created.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const counts = { images: isVideo ? 0 : files.length, videos: isVideo ? (files.length ? 1 : driveUrl.trim() ? 1 : 0) : 0, caption };
  const problem = useMemo(() => {
    const own = formatProblem(format, counts);
    if (own) return own;
    for (const a of usable.filter((x) => selected.includes(x.id))) {
      const p = publishProblem(a.platform, counts);
      if (p) return `${a.name}: ${p}`;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- counts é derivado destes valores
  }, [format, files, driveUrl, caption, selected, usable]);

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    setError(null);
    if (isVideo) {
      const video = incoming.find((f) => VIDEO_TYPES.includes(f.type));
      if (!video) return setError("Envie o vídeo em MP4 ou MOV.");
      if (video.size > MAX_VIDEO_BYTES) return setError("O vídeo passa de 50 MB. Cole abaixo o link do Google Drive.");
      setDriveUrl("");
      return setFiles([video]);
    }
    const images = incoming.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return setError("Envie imagens neste formato.");
    setFiles((cur) => [...cur, ...images].slice(0, 10));
  }

  function changeFormat(next: ContentFormat) {
    setFormat(next);
    setFiles([]);
    setError(null);
  }

  function reset() {
    setFiles([]);
    setCaption("");
    setTitle("");
    setDriveUrl("");
    setDate("");
    setClientId(NONE);
    setError(null);
    setProgress(null);
    setLink(null);
  }

  async function upload(contentId: string) {
    const client = createClient();
    for (const file of files) {
      setProgress(`Enviando ${file.name}…`);
      if (isVideo) {
        const prep = await prepareVideoUpload({ contentId, size: file.size, mime: file.type });
        if (!prep.ok) throw new Error(prep.message);
        const { error: e } = await client.storage.from("content-media").uploadToSignedUrl(prep.data.path, prep.data.token, file, { contentType: file.type });
        if (e) throw new Error(`Não foi possível enviar ${file.name}.`);
        const reg = await registerVideo({ contentId, path: prep.data.path, fileName: file.name.slice(0, 200), size: file.size, mime: file.type });
        if (!reg.ok) throw new Error(reg.message);
      } else {
        const blob = await toJpeg(file);
        const prep = await prepareImageUpload({ contentId, size: blob.size });
        if (!prep.ok) throw new Error(prep.message);
        const { error: e } = await client.storage.from("content-media").uploadToSignedUrl(prep.data.path, prep.data.token, blob, { contentType: "image/jpeg" });
        if (e) throw new Error(`Não foi possível enviar ${file.name}.`);
        const reg = await registerImage({ contentId, path: prep.data.path, fileName: file.name.slice(0, 200), size: blob.size });
        if (!reg.ok) throw new Error(reg.message);
      }
    }
    if (isVideo && !files.length && driveUrl.trim()) {
      const res = await addDriveVideo({ contentId, url: driveUrl });
      if (!res.ok) throw new Error(res.message);
      if (res.data.status === "inacessivel") throw new Error("O link do Drive não está acessível. No Drive, escolha Qualquer pessoa com o link. O rascunho foi salvo.");
    }
  }

  function submit(mode: "programar" | "aprovacao" | "rascunho") {
    setError(null);
    startTransition(async () => {
      let contentId: string | null = null;
      try {
        setProgress("Criando…");
        const name = title.trim() || caption.trim().slice(0, 60) || `${FORMAT_LABEL[format]} sem título`;
        const draft = await createStudioDraft({ format, title: name, caption, clientId: hasClient ? clientId : null, date: date || null, time: date ? time : null });
        if (!draft.ok) throw new Error(Object.values(draft.fieldErrors ?? {})[0]?.[0] ?? draft.message);
        contentId = draft.data.id;
        await upload(contentId);
        if (mode === "rascunho") {
          toast.success("Rascunho salvo.");
        } else if (mode === "aprovacao") {
          setProgress("Gerando o link…");
          const res = await requestApproval({ id: contentId });
          if (!res.ok) throw new Error(res.message);
          setLink(res.data.url);
          setProgress(null);
          router.refresh();
          return;
        } else {
          setProgress("Programando…");
          const approved = await approveInternally({ id: contentId });
          if (!approved.ok) throw new Error(approved.message);
          const res = await scheduleContent({ id: contentId, accountIds: selected, date, time });
          if (!res.ok) throw new Error(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message);
          toast.success("Publicação programada.");
        }
        setOpen(false);
        reset();
        router.refresh();
      } catch (e) {
        setProgress(null);
        setError(`${(e as Error).message || "Não foi possível concluir."}${contentId ? " O rascunho foi salvo em Produção." : ""}`);
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Criar publicação</DialogTitle>
          <DialogDescription>Escolha o formato, as contas e o horário. A prévia acompanha o que você escreve.</DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="grid gap-3" role="status">
            <p className="text-sm">Envie este link ao cliente. Depois da aprovação, abra o conteúdo em Produção para programar. Ele vale por 14 dias e só aparece agora.</p>
            <div className="flex gap-1">
              <Input readOnly value={link} aria-label="Link de aprovação" spellCheck={false} onFocus={(e) => e.target.select()} />
              <Button variant="outline" size="icon" aria-label="Copiar link" onClick={() => void navigator.clipboard?.writeText(link).then(() => toast.success("Link copiado."))}>
                <Copy aria-hidden="true" />
              </Button>
            </div>
            <Button
              className="justify-self-start"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Concluir
            </Button>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
            <div className="grid min-w-0 content-start gap-4">
              <FormAlert>{error}</FormAlert>
              <div role="group" aria-label="Formato" className="grid grid-cols-3 gap-2">
                {(Object.keys(FORMAT_LABEL) as ContentFormat[]).map((k) => {
                  const Icon = FORMAT_ICON[k];
                  return (
                    <button key={k} type="button" aria-pressed={format === k} onClick={() => changeFormat(k)} className={cn("grid justify-items-center gap-1 rounded-xl border p-3 text-sm font-medium transition-colors hover:border-primary", format === k ? "border-primary bg-accent text-accent-foreground" : "bg-surface")}>
                      <Icon className="size-5" aria-hidden="true" /> {FORMAT_LABEL[k]}
                    </button>
                  );
                })}
              </div>

              <fieldset className="grid gap-1.5">
                <legend className="mb-1 text-sm font-medium">Publicar em</legend>
                {usable.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma conta ativa.{" "}
                    <Link href="/conteudo?aba=contas" className="text-primary hover:underline">
                      Escolha suas contas
                    </Link>
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {usable.map((a) => {
                      const on = selected.includes(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            setSelected((l) => (on ? l.filter((x) => x !== a.id) : [...l, a.id]));
                            setPreviewId(a.id);
                          }}
                          className={cn("flex max-w-56 items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm transition-colors", on ? "border-primary bg-accent" : "bg-surface opacity-70 hover:opacity-100")}
                        >
                          <AccountAvatar account={a} size="sm" />
                          <span className="truncate">{a.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </fieldset>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  addFiles(e.dataTransfer.files);
                }}
                className={cn("grid gap-2 rounded-xl border-2 border-dashed p-4 text-center text-sm transition-colors", dragging && "border-primary bg-accent")}
              >
                <input ref={input} type="file" multiple={!isVideo} accept={isVideo ? "video/mp4,video/quicktime" : "image/*"} className="sr-only" tabIndex={-1} aria-label={isVideo ? "Arquivo de vídeo" : "Imagens"} onChange={(e) => e.target.files?.length && addFiles(e.target.files)} />
                <Upload className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
                <p className="text-muted-foreground">{isVideo ? "Arraste o vídeo (MP4 ou MOV, até 50 MB)" : "Arraste as imagens (até 10)"}</p>
                <Button type="button" variant="outline" size="sm" className="justify-self-center" onClick={() => input.current?.click()}>
                  Escolher {isVideo ? "vídeo" : "imagens"}
                </Button>
                {files.length > 0 && (
                  <ul className="flex flex-wrap justify-center gap-1.5 text-left">
                    {files.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="flex max-w-56 items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
                        <span className="truncate">{f.name}</span>
                        <button type="button" aria-label={`Remover ${f.name}`} onClick={() => setFiles((l) => l.filter((_, j) => j !== i))}>
                          <X className="size-3.5" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {isVideo && !files.length && (
                  <div className="grid gap-1 text-left">
                    <label htmlFor="studio-drive" className="text-xs text-muted-foreground">
                      Ou cole o link do Google Drive, para vídeos maiores
                    </label>
                    <Input id="studio-drive" type="url" inputMode="url" spellCheck={false} placeholder="https://drive.google.com/file/d/…" value={driveUrl} maxLength={500} onChange={(e) => setDriveUrl(e.target.value)} />
                  </div>
                )}
              </div>

              <FormField label="Legenda" optional={format !== "post" || files.length > 0}>
                <Textarea rows={5} value={caption} maxLength={IG_CAPTION_MAX} onChange={(e) => setCaption(e.target.value)} placeholder="Escreva a legenda, com hashtags se quiser…" />
              </FormField>
              <p className="-mt-3 text-right text-xs text-muted-foreground tabular">
                {caption.length} de {IG_CAPTION_MAX}
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Nome interno" optional hint="Só a equipe vê. Em branco, usa o começo da legenda.">
                  <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
                </FormField>
                <FormField label="Cliente" optional hint="Com cliente, a publicação precisa da aprovação dele.">
                  <Select value={clientId} onValueChange={setClientId}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Sem cliente</SelectItem>
                      {clients.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.legal_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Data" required={!hasClient}>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </FormField>
                <FormField label="Horário">
                  <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </FormField>
              </div>

              {problem && (
                <p role="status" className="flex items-start gap-2 text-sm text-warning">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {problem}
                </p>
              )}
              {progress && (
                <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> {progress}
                </p>
              )}

              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" disabled={pending} onClick={() => submit("rascunho")}>
                  Salvar rascunho
                </Button>
                {hasClient ? (
                  <Button disabled={pending || Boolean(problem)} onClick={() => submit("aprovacao")}>
                    <Send aria-hidden="true" /> Enviar para o cliente aprovar
                  </Button>
                ) : (
                  <Button disabled={pending || Boolean(problem) || !selected.length || !date || !time} onClick={() => submit("programar")}>
                    <CalendarClock aria-hidden="true" /> Programar publicação
                  </Button>
                )}
              </div>
            </div>

            <aside className="grid content-start gap-2">
              <p className="text-center text-xs text-muted-foreground">{previewAccount ? `Como fica no ${PLATFORM_LABEL[previewAccount.platform]}` : "Prévia"}</p>
              <PhonePreview account={previewAccount} format={format} caption={caption} images={isVideo ? [] : urls} video={isVideo ? (urls[0] ?? null) : null} driveUrl={driveUrl} />
            </aside>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CreateButtons({ accounts, account }: { accounts: SocialAccount[]; account: string | null }) {
  return (
    <>
      <Composer accounts={accounts} initialAccount={account} initialFormat="post" trigger={<Button><Plus aria-hidden="true" /> Criar post</Button>} />
      <Composer accounts={accounts} initialAccount={account} initialFormat="video" trigger={<Button variant="outline"><Video aria-hidden="true" /> Vídeo</Button>} />
      <Composer accounts={accounts} initialAccount={account} initialFormat="reels" trigger={<Button variant="outline"><Clapperboard aria-hidden="true" /> Reels</Button>} />
    </>
  );
}

export function RecentPublished({ schedules }: { schedules: ScheduleRow[] }) {
  const done = schedules.filter((s) => s.status === "publicado" || s.status === "erro").slice(-6).reverse();
  if (!done.length) return null;
  return (
    <section aria-labelledby="resultados" className="grid gap-2">
      <h3 id="resultados" className="text-sm font-semibold">
        Resultados recentes
      </h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {done.map((s) => (
          <li key={s.id} className={cn("flex min-w-0 items-center gap-2 rounded-lg border bg-surface p-2 text-sm", s.status === "erro" && "border-danger/40")}>
            {s.account && <PlatformMark platform={s.account.platform} className="size-5 shrink-0" />}
            <Link href={`/conteudo/${s.content_id}`} className="min-w-0 flex-1 truncate hover:underline">
              {s.title}
            </Link>
            {s.permalink ? (
              <a href={s.permalink} target="_blank" rel="noreferrer" aria-label={`Ver ${s.title} na rede`} className="text-primary">
                <ExternalLink className="size-4" aria-hidden="true" />
              </a>
            ) : (
              <span className="text-xs text-danger">Erro</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

