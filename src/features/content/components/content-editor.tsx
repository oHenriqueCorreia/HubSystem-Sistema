"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, Copy, ExternalLink, ImagePlus, LoaderCircle, RefreshCw, Send, Trash2, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormField } from "@/components/app/form-field";
import { dayKey, minutesOfDay } from "@/domain/calendar";
import { drivePreviewUrl, FORMAT_LABEL, IG_CAPTION_MAX, PLATFORM_LABEL, publishProblem, SCHEDULE_STATUS_LABEL, type ContentFormat, type ContentStatus } from "@/domain/content";
import { formatDateTime } from "@/domain/shared/dates";
import { createClient } from "@/lib/supabase/client";
import { addDriveVideo, cancelSchedule, prepareImageUpload, recheckDriveVideo, registerImage, removeAsset, requestApproval, rescheduleContent, saveCaption, scheduleContent, setContentCampaign, setContentFormat, approveInternally } from "../actions";
import type { ContentAsset, SocialAccount } from "../queries";
import { ContentStatusBadge } from "./content-status";

const NONE = "__nenhuma__";

const hhmm = (iso: string) => {
  const m = minutesOfDay(iso);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

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

type Props = {
  id: string;
  status: ContentStatus;
  format: ContentFormat;
  caption: string;
  version: number;
  approvedVersion: number | null;
  lastError: string | null;
  title: string;
  taskId: string;
  clientName: string | null;
  board: { id: string; name: string } | null;
  list: string | null;
  campaignId: string | null;
  campaigns: { id: string; name: string }[];
  assets: ContentAsset[];
  reviews: { id: string; version: number; decision: "aprovado" | "ajustes"; comment: string | null; reviewer_name: string; created_at: string }[];
  schedules: { id: string; account_id: string; scheduled_at: string; status: string; permalink: string | null; error: string | null; published_at: string | null; version: number }[];
  accounts: SocialAccount[];
  canManage: boolean;
  canPublish: boolean;
};

export function ContentEditor(p: Props) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState(p.caption);
  const [driveUrl, setDriveUrl] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const published = p.status === "publicado";
  const editable = p.canManage && !published;
  const approved = p.approvedVersion === p.version && ["aprovado", "agendado", "erro"].includes(p.status);
  const images = p.assets.filter((a) => a.kind === "imagem");
  const videos = p.assets.filter((a) => a.kind === "video_drive");
  const videoFiles = p.assets.filter((a) => a.kind === "video_arquivo");
  const dirty = caption !== p.caption;
  const wasApproved = p.approvedVersion === p.version;

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.message);
      if (res.message) toast.success(res.message);
      after?.();
      router.refresh();
    });
  }

  function upload(files: FileList) {
    startTransition(async () => {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          toast.error(`${file.name}: envie uma imagem.`);
          continue;
        }
        setProgress(`Enviando ${file.name}…`);
        try {
          const blob = await toJpeg(file);
          const prep = await prepareImageUpload({ contentId: p.id, size: blob.size });
          if (!prep.ok) {
            toast.error(prep.message);
            continue;
          }
          const { error } = await createClient().storage.from("content-media").uploadToSignedUrl(prep.data.path, prep.data.token, blob, { contentType: "image/jpeg" });
          if (error) throw error;
          const reg = await registerImage({ contentId: p.id, path: prep.data.path, fileName: file.name.slice(0, 200), size: blob.size });
          if (!reg.ok) toast.error(reg.message);
        } catch {
          toast.error(`${file.name}: não foi possível enviar a imagem.`);
        }
      }
      setProgress(null);
      if (input.current) input.current.value = "";
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid min-w-0 content-start gap-6">
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Situação</dt>
            <dd>
              <ContentStatusBadge status={p.status} />
            </dd>
          </div>
          {p.clientName && (
            <div>
              <dt className="text-xs text-muted-foreground">Cliente</dt>
              <dd className="break-words">{p.clientName}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-muted-foreground">Quadro e lista</dt>
            <dd className="break-words">
              {p.board ? (
                <Link href={`/tarefas?modo=quadro&quadro=${p.board.id}`} className="text-primary hover:underline">
                  {p.board.name}
                </Link>
              ) : (
                "Quadro"
              )}
              {p.list && ` › ${p.list}`}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Tarefa</dt>
            <dd>
              <Link href={`/tarefas?tarefa=${p.taskId}`} className="text-primary hover:underline">
                Abrir tarefa
              </Link>
            </dd>
          </div>
        </dl>
        {p.lastError && (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" /> {p.lastError}
          </p>
        )}

        <section aria-labelledby="imagens" className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="imagens" className="text-sm font-semibold">
              Imagens
            </h2>
            {editable && (
              <>
                <input ref={input} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => e.target.files?.length && upload(e.target.files)} />
                <Button size="sm" variant="outline" disabled={pending} onClick={() => input.current?.click()}>
                  <ImagePlus aria-hidden="true" /> Anexar imagens
                </Button>
              </>
            )}
          </div>
          {progress && (
            <p role="status" className="text-xs text-muted-foreground">
              {progress}
            </p>
          )}
          {images.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma imagem. As imagens são convertidas para JPEG, formato exigido pelo Instagram.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {images.map((a) => (
                <li key={a.id} className="relative">
                  {a.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- link assinado e temporário do armazenamento privado
                    <img src={a.url} alt={a.file_name ?? "Imagem do conteúdo"} width={320} height={320} loading="lazy" className="aspect-square w-full rounded-lg border object-cover" />
                  ) : (
                    <p className="grid aspect-square place-items-center rounded-lg border text-xs text-muted-foreground">Prévia indisponível</p>
                  )}
                  {editable && (
                    <ConfirmDialog
                      tone="danger"
                      trigger={
                        <Button variant="secondary" size="icon-xs" className="absolute top-1 right-1" disabled={pending} aria-label={`Remover ${a.file_name ?? "imagem"}`}>
                          <Trash2 aria-hidden="true" />
                        </Button>
                      }
                      title="Remover esta imagem?"
                      description={wasApproved ? "O conteúdo está aprovado: remover cancela os agendamentos e exige nova aprovação." : "A imagem sai do conteúdo e do armazenamento."}
                      confirmLabel="Remover imagem"
                      onConfirm={async () => run(() => removeAsset({ id: a.id, contentId: p.id }))}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="videos" className="grid gap-2">
          <h2 id="videos" className="text-sm font-semibold">
            Vídeo pelo Google Drive
          </h2>
          {videoFiles.map((v) => (
            <div key={v.id} className="grid gap-2 rounded-lg border p-2">
              {v.url && <video controls preload="metadata" src={v.url} className="max-h-96 w-full rounded bg-black" />}
              {editable && (
                <Button size="sm" variant="ghost" className="justify-self-start text-danger" disabled={pending} onClick={() => run(() => removeAsset({ id: v.id, contentId: p.id }))}>
                  <Trash2 aria-hidden="true" /> Remover vídeo enviado
                </Button>
              )}
            </div>
          ))}
          {videos.map((v) => (
            <div key={v.id} className="grid gap-2 rounded-lg border p-2">
              {v.drive_status === "inacessivel" ? (
                <p role="alert" className="flex items-start gap-2 text-sm text-danger">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> Este link não está acessível para revisão. No Drive, em Compartilhar, escolha Qualquer pessoa com o link.
                </p>
              ) : (
                <iframe src={drivePreviewUrl(v.drive_file_id!)} title="Prévia do vídeo" allow="autoplay" loading="lazy" className="aspect-video w-full rounded border" />
              )}
              {v.drive_status === "nao_verificado" && <p className="text-xs text-warning">Não foi possível conferir o acesso a este link.</p>}
              <div className="flex flex-wrap items-center gap-2">
                <a href={v.drive_url ?? "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                  <ExternalLink className="size-4" aria-hidden="true" /> Abrir no Drive
                </a>
                {editable && (
                  <>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => recheckDriveVideo({ id: v.id, contentId: p.id }))}>
                      <RefreshCw aria-hidden="true" /> Conferir acesso
                    </Button>
                    <ConfirmDialog
                      tone="danger"
                      trigger={
                        <Button size="sm" variant="ghost" className="text-danger" disabled={pending}>
                          <Trash2 aria-hidden="true" /> Remover
                        </Button>
                      }
                      title="Remover este vídeo?"
                      description={wasApproved ? "O conteúdo está aprovado: remover cancela os agendamentos e exige nova aprovação." : "O arquivo continua no seu Google Drive."}
                      confirmLabel="Remover vídeo"
                      onConfirm={async () => run(() => removeAsset({ id: v.id, contentId: p.id }))}
                    />
                  </>
                )}
              </div>
            </div>
          ))}
          {editable && (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => addDriveVideo({ contentId: p.id, url: driveUrl }), () => setDriveUrl(""));
              }}
            >
              <Input type="url" inputMode="url" spellCheck={false} value={driveUrl} maxLength={500} onChange={(e) => setDriveUrl(e.target.value)} placeholder="https://drive.google.com/file/d/…" aria-label="Link do vídeo no Google Drive" className="min-w-0 flex-1" />
              <Button type="submit" variant="outline" disabled={pending || !driveUrl.trim()}>
                <Video aria-hidden="true" /> Adicionar vídeo
              </Button>
            </form>
          )}
        </section>

        <section aria-labelledby="legenda" className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <h2 id="legenda" className="text-sm font-semibold">
              Legenda
            </h2>
            <span className="text-xs tabular text-muted-foreground">
              {caption.length} de {IG_CAPTION_MAX}
            </span>
          </div>
          <Textarea rows={7} value={caption} maxLength={IG_CAPTION_MAX} disabled={!editable} aria-labelledby="legenda" onChange={(e) => setCaption(e.target.value)} />
          {dirty && wasApproved && <p className="text-sm text-warning">Este conteúdo está aprovado. Salvar a alteração cancela os agendamentos e exige nova aprovação.</p>}
          {editable && (
            <Button variant="outline" className="justify-self-start" disabled={pending || !dirty} onClick={() => run(() => saveCaption({ id: p.id, caption }))}>
              Salvar legenda
            </Button>
          )}
        </section>

        {editable && (
          <FormField label="Formato" hint="Reels sai em vídeo vertical. Vídeo sai como vídeo na Página e como Reels no Instagram. Stories leva uma imagem ou um vídeo de até 60 segundos, sem legenda.">
            <Select value={p.format} disabled={pending} onValueChange={(v) => run(() => setContentFormat({ id: p.id, format: v as ContentFormat }))}>
              <SelectTrigger className="w-full sm:w-60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FORMAT_LABEL).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        )}

        {p.canManage && p.campaigns.length > 0 && (
          <FormField label="Campanha" optional>
            <Select value={p.campaignId ?? NONE} disabled={pending} onValueChange={(v) => run(() => setContentCampaign({ id: p.id, campaignId: v === NONE ? null : v }))}>
              <SelectTrigger className="w-full sm:w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Nenhuma</SelectItem>
                {p.campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        )}
      </div>

      <aside className="grid content-start gap-6">
        <section aria-labelledby="aprovacao" className="grid gap-3 rounded-xl border bg-surface p-4 text-sm">
          <h2 id="aprovacao" className="font-semibold">
            Aprovação do cliente
          </h2>
          {editable && !approved && (
            <Button disabled={pending || dirty} onClick={() => run(() => requestApproval({ id: p.id }).then((res) => {
              if (res.ok) setLink(res.data.url);
              return res;
            }))}>
              <Send aria-hidden="true" /> {p.status === "aguardando_aprovacao" ? "Gerar novo link" : "Enviar para aprovação"}
            </Button>
          )}
          {editable && !approved && !p.clientName && p.canPublish && (
            <Button variant="outline" disabled={pending || dirty} onClick={() => run(() => approveInternally({ id: p.id }))}>
              Aprovar pela equipe
            </Button>
          )}
          {dirty && <p className="text-xs text-muted-foreground">Salve a legenda antes de enviar.</p>}
          {link && (
            <div className="grid gap-1.5" role="status">
              <p className="text-xs text-muted-foreground">Envie este link ao cliente. Ele vale por 14 dias e só aparece agora.</p>
              <div className="flex gap-1">
                <Input readOnly value={link} aria-label="Link de aprovação" spellCheck={false} onFocus={(e) => e.target.select()} />
                <Button variant="outline" size="icon" aria-label="Copiar link" onClick={() => void navigator.clipboard?.writeText(link).then(() => toast.success("Link copiado."))}>
                  <Copy aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
          {p.reviews.length === 0 ? (
            <p className="text-muted-foreground">Nenhuma decisão ainda.</p>
          ) : (
            <ul className="grid gap-2">
              {p.reviews.map((r) => (
                <li key={r.id} className="grid gap-0.5 border-t pt-2 first:border-0 first:pt-0">
                  <p className="font-medium">{r.decision === "aprovado" ? "Aprovado" : "Ajustes solicitados"}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.reviewer_name} em {formatDateTime(r.created_at)}
                    {r.version !== p.version ? ", versão anterior" : ""}
                  </p>
                  {r.comment && <p className="break-words whitespace-pre-wrap">{r.comment}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <ScheduleBox {...p} approved={approved} images={images.length} videos={videos.length + videoFiles.length} caption={p.caption} blockedVideo={videos.some((v) => v.drive_status === "inacessivel")} />
      </aside>
    </div>
  );
}

function ScheduleBox({ id, schedules, accounts, canPublish, approved, images, videos, caption, blockedVideo }: Props & { approved: boolean; images: number; videos: number; blockedVideo: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [editing, setEditing] = useState<string | null>(null);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [pending, startTransition] = useTransition();
  const name = (accountId: string) => {
    const a = accounts.find((x) => x.id === accountId);
    return a ? `${a.name} (${PLATFORM_LABEL[a.platform]})` : "Conta removida";
  };
  const usable = accounts.filter((a) => a.selected && a.status === "ativa");
  const problems = usable.filter((a) => selected.includes(a.id)).map((a) => [a.name, publishProblem(a.platform, { images, videos, caption })] as const).filter(([, m]) => m);

  function run(fn: () => Promise<{ ok: boolean; message?: string; fieldErrors?: Record<string, string[]> }>, after?: () => void) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message);
      if (res.message) toast.success(res.message);
      after?.();
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="publicacao" className="grid gap-3 rounded-xl border bg-surface p-4 text-sm">
      <h2 id="publicacao" className="font-semibold">
        Publicação
      </h2>
      {canPublish &&
        (approved ? (
          usable.length === 0 ? (
            <p className="text-muted-foreground">
              Nenhuma conta disponível.{" "}
              <Link href="/conteudo?aba=contas" className="text-primary hover:underline">
                Conectar e escolher contas
              </Link>
            </p>
          ) : (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => scheduleContent({ id, accountIds: selected, date, time }), () => setSelected([]));
              }}
            >
              <fieldset className="grid gap-1">
                <legend className="mb-1 text-xs text-muted-foreground">Contas de destino</legend>
                {usable.map((a) => (
                  <label key={a.id} className="flex min-h-8 items-center gap-2">
                    <Checkbox checked={selected.includes(a.id)} onCheckedChange={(v) => setSelected((l) => (v ? [...l, a.id] : l.filter((x) => x !== a.id)))} />
                    <span className="min-w-0 break-words">
                      {a.name} <span className="text-xs text-muted-foreground">{PLATFORM_LABEL[a.platform]}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="grid grid-cols-2 gap-2">
                <FormField label="Data" required>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </FormField>
                <FormField label="Horário" required>
                  <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </FormField>
              </div>
              {problems.map(([n, m]) => (
                <p key={n} role="alert" className="text-danger">
                  {n}: {m}
                </p>
              ))}
              {blockedVideo && (
                <p role="alert" className="text-danger">
                  Abra o acesso ao vídeo no Drive para poder agendar.
                </p>
              )}
              <Button type="submit" disabled={pending || !selected.length || !date || !time || problems.length > 0 || blockedVideo}>
                {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <CalendarClock aria-hidden="true" />} Agendar publicação
              </Button>
              <p className="text-xs text-muted-foreground">Horário de Brasília. A publicação sai automaticamente em até um minuto depois do horário.</p>
            </form>
          )
        ) : (
          <p className="text-muted-foreground">O agendamento libera quando o cliente aprovar a versão atual.</p>
        ))}
      {schedules.length > 0 && (
        <ul className="grid gap-2 border-t pt-3">
          {schedules.map((s) => (
            <li key={s.id} className="grid gap-1">
              <p className="break-words">
                <span className="font-medium">{name(s.account_id)}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {SCHEDULE_STATUS_LABEL[s.status] ?? s.status}, {formatDateTime(s.published_at ?? s.scheduled_at)}
              </p>
              {s.error && <p className="text-xs break-words text-danger">{s.error}</p>}
              {s.permalink && (
                <a href={s.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  <ExternalLink className="size-3.5" aria-hidden="true" /> Ver publicação
                </a>
              )}
              {canPublish && s.status === "agendado" && (
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      setEditing(s.id);
                      setNewDate(dayKey(s.scheduled_at));
                      setNewTime(hhmm(s.scheduled_at));
                    }}
                  >
                    Editar horário
                  </Button>
                  <ConfirmDialog
                    tone="danger"
                    trigger={
                      <Button size="xs" variant="ghost" className="text-danger">
                        Cancelar
                      </Button>
                    }
                    title="Cancelar este agendamento?"
                    description="A publicação não sai nesta conta. O conteúdo continua aprovado."
                    confirmLabel="Cancelar agendamento"
                    onConfirm={async () => run(() => cancelSchedule({ id: s.id, contentId: id }))}
                  />
                </div>
              )}
              {editing === s.id && (
                <form
                  className="grid grid-cols-2 gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(() => rescheduleContent({ id: s.id, contentId: id, date: newDate, time: newTime }), () => setEditing(null));
                  }}
                >
                  <Input type="date" aria-label="Nova data" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
                  <Input type="time" aria-label="Novo horário" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
                  <Button type="submit" size="xs" className="col-span-2 justify-self-start" disabled={pending}>
                    Salvar horário
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
