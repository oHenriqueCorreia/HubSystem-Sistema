"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, FileText, Link2, LoaderCircle, MessageCircle, Pencil, Plus, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { DELIVERY_ACCEPT, DELIVERY_KINDS, DELIVERY_MAX_BYTES, DELIVERY_STATUS_LABEL, MAKER_ROLES, type DeliveryStatus } from "@/domain/deliveries";
import { formatDate, formatDateTime } from "@/domain/shared/dates";
import { whatsappLink } from "@/domain/shared/phone";
import { createClient } from "@/lib/supabase/client";
import { addDeliveryDrive, deleteDelivery, generateDeliveryLink, listDeliveries, newDeliveryVersion, prepareDeliveryUpload, registerDeliveryFile, removeDeliveryFile, revokeDeliveryLink, saveDelivery } from "../delivery-actions";
import { DELIVERIES_BUCKET, type Delivery } from "../delivery-types";
import type { Task } from "../types";

type Owner = { id: string; full_name: string; email: string };
type Loaded = { deliveries: Delivery[]; canManage: boolean; link: { url: string; expires_at: string } | null };

const NONE = "__ninguem";
const TONE: Record<DeliveryStatus, string> = {
  aguardando: "border-warning/40 bg-warning-soft text-foreground",
  aprovado: "border-success/40 bg-success-soft text-foreground",
  recusado: "border-danger/40 bg-danger-soft text-foreground",
};

export function DeliveryBadge({ status, label }: { status: DeliveryStatus; label?: string }) {
  return (
    <Badge variant="outline" className={TONE[status]}>
      {label ?? DELIVERY_STATUS_LABEL[status]}
    </Badge>
  );
}

async function uploadAll(deliveryId: string, files: File[]) {
  for (const file of files) {
    if (file.size > DELIVERY_MAX_BYTES) throw new Error(`${file.name} passa de 50 MB. Use o link do Google Drive.`);
    const prep = await prepareDeliveryUpload({ deliveryId, mime: file.type, size: file.size });
    if (!prep.ok) throw new Error(prep.message);
    const { error } = await createClient().storage.from(DELIVERIES_BUCKET).uploadToSignedUrl(prep.data.path, prep.data.token, file, { contentType: prep.data.mime });
    if (error) throw new Error(`Não foi possível enviar ${file.name}.`);
    const reg = await registerDeliveryFile({ deliveryId, path: prep.data.path, name: file.name.slice(0, 200), mime: file.type, size: file.size });
    if (!reg.ok) throw new Error(reg.message);
  }
}

function DeliveryForm({ task, owners, delivery, open, onOpenChange, onSaved }: { task: Task; owners: Owner[]; delivery: Delivery | null; open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const [kind, setKind] = useState(delivery?.kind ?? "Post");
  const [title, setTitle] = useState(delivery?.title ?? "");
  const [makerId, setMakerId] = useState(delivery?.maker_id ?? task.owner_id ?? NONE);
  const [makerRole, setMakerRole] = useState(delivery?.maker_role ?? "");
  const [notes, setNotes] = useState(delivery?.notes ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fallback = [kind.trim(), task.client?.legal_name].filter(Boolean).join(" ");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await saveDelivery({ id: delivery?.id, taskId: task.id, kind, title: title.trim() || fallback, notes, makerId: makerId === NONE ? null : makerId, makerRole });
      if (!res.ok) return setError(res.message ?? "Não foi possível salvar.");
      await uploadAll(res.data.id, files);
      toast.success(res.message);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      // A entrega já existe: o erro é só do arquivo, que pode ser enviado de novo no painel.
      setError(err instanceof Error ? err.message : "Não foi possível enviar o arquivo.");
      onSaved();
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{delivery ? "Editar entrega" : "Nova entrega"}</DialogTitle>
          <DialogDescription>O cliente vê os arquivos, o nome e a legenda no link de aprovação.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="entrega-tipo">Tipo</Label>
              <Input id="entrega-tipo" name="tipo" list="entrega-tipos" required maxLength={40} autoComplete="off" value={kind} onChange={(e) => setKind(e.target.value)} />
              <datalist id="entrega-tipos">
                {DELIVERY_KINDS.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="entrega-nome">Nome</Label>
              <Input id="entrega-nome" name="nome" maxLength={160} autoComplete="off" placeholder={fallback || "Ex.: Post de lançamento…"} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="entrega-feito">Feito por</Label>
              <Select value={makerId} onValueChange={setMakerId}>
                <SelectTrigger id="entrega-feito" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Não informar</SelectItem>
                  {owners.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.full_name || o.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="entrega-funcao">Função</Label>
              <Input id="entrega-funcao" name="funcao" list="entrega-funcoes" maxLength={60} autoComplete="off" placeholder="Ex.: Designer gráfico…" value={makerRole} onChange={(e) => setMakerRole(e.target.value)} />
              <datalist id="entrega-funcoes">
                {MAKER_ROLES.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="entrega-notas">Legenda ou observações para o cliente</Label>
            <Textarea id="entrega-notas" name="observacoes" rows={3} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {!delivery && (
            <div className="grid gap-1.5">
              <Label htmlFor="entrega-arquivos">Arquivos</Label>
              <Input id="entrega-arquivos" name="arquivos" type="file" multiple accept={DELIVERY_ACCEPT} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
              <p className="text-xs text-muted-foreground">Imagem, vídeo, PDF, Word, PowerPoint ou Excel, até 50 MB. Para vídeos maiores, salve e cole o link do Google Drive.</p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              {pending ? "Salvando…" : delivery ? "Salvar entrega" : "Criar entrega"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeliveryCard({ task, owners, delivery, canManage, onChanged }: { task: Task; owners: Owner[]; delivery: Delivery; canManage: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [drive, setDrive] = useState("");
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const adder = useRef<HTMLInputElement>(null);
  const versioner = useRef<HTMLInputElement>(null);
  const waiting = delivery.status === "aguardando";

  async function add(list: FileList | null, bump: boolean) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setBusy(true);
    try {
      if (bump) {
        const res = await newDeliveryVersion({ id: delivery.id });
        if (!res.ok) throw new Error(res.message);
      }
      await uploadAll(delivery.id, files);
      toast.success(bump ? "Nova versão enviada. O cliente já pode revisar pelo mesmo link." : "Arquivo adicionado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível enviar o arquivo.");
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  return (
    <li className="grid gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid min-w-0 gap-0.5">
          <p className="text-xs text-muted-foreground">
            {delivery.kind}
            {delivery.version > 1 && `, versão ${delivery.version}`}
          </p>
          <p className="text-sm font-medium break-words">{delivery.title}</p>
          {(delivery.maker_name || delivery.maker_role) && <p className="text-xs break-words text-muted-foreground">Feito por {[delivery.maker_name, delivery.maker_role].filter(Boolean).join(", ")}</p>}
        </div>
        <DeliveryBadge status={delivery.status} />
      </div>

      {delivery.files.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum arquivo nesta versão.</p>
      ) : (
        <ul className="grid gap-1.5">
          {delivery.files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 text-sm">
              {f.kind === "imagem" && f.url ? (
                /* eslint-disable-next-line @next/next/no-img-element -- link assinado e temporário do armazenamento privado */
                <img src={f.url} alt="" width={40} height={40} loading="lazy" className="size-10 shrink-0 rounded border object-cover" />
              ) : (
                <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              {f.url ? (
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-primary hover:underline">
                  {f.file_name}
                </a>
              ) : (
                <a href={`https://drive.google.com/file/d/${f.drive_file_id}/view`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-primary hover:underline">
                  {f.file_name}
                </a>
              )}
              {canManage && waiting && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remover ${f.file_name}`}
                  disabled={busy}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await removeDeliveryFile({ id: f.id });
                      if (!res.ok) toast.error(res.message);
                      onChanged();
                    })
                  }
                >
                  <X aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="flex flex-wrap gap-2">
          {waiting ? (
            <>
              <input ref={adder} type="file" hidden multiple accept={DELIVERY_ACCEPT} aria-label={`Adicionar arquivos em ${delivery.title}`} onChange={(e) => void add(e.target.files, false).finally(() => (e.target.value = ""))} />
              <Button variant="outline" size="sm" disabled={busy} onClick={() => adder.current?.click()}>
                {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />} Adicionar arquivo
              </Button>
            </>
          ) : (
            <>
              <input ref={versioner} type="file" hidden multiple accept={DELIVERY_ACCEPT} aria-label={`Arquivos da nova versão de ${delivery.title}`} onChange={(e) => void add(e.target.files, true).finally(() => (e.target.value = ""))} />
              <Button variant={delivery.status === "recusado" ? "default" : "outline"} size="sm" disabled={busy} onClick={() => versioner.current?.click()}>
                {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />} Enviar nova versão
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil aria-hidden="true" /> Editar
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm" className="text-danger">
                <Trash2 aria-hidden="true" /> Excluir
              </Button>
            }
            title="Excluir esta entrega?"
            description="Os arquivos e os comentários do cliente serão apagados, e não dá para desfazer."
            confirmLabel="Excluir"
            onConfirm={async () => {
              const res = await deleteDelivery({ id: delivery.id });
              if (!res.ok) {
                toast.error(res.message);
                return false;
              }
              toast.success(res.message);
              onChanged();
            }}
          />
        </div>
      )}

      {canManage && waiting && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await addDeliveryDrive({ deliveryId: delivery.id, url: drive });
              if (!res.ok) return void toast.error(res.message);
              toast.success(res.message);
              setDrive("");
              onChanged();
            });
          }}
        >
          <Input type="url" inputMode="url" name="drive" autoComplete="off" spellCheck={false} value={drive} aria-label="Link do Google Drive" placeholder="Link do Google Drive para vídeos grandes…" onChange={(e) => setDrive(e.target.value)} />
          <Button type="submit" variant="outline" size="sm" disabled={!drive.trim()}>
            Adicionar
          </Button>
        </form>
      )}

      {delivery.reviews.length > 0 && (
        <ul aria-label="Comentários do cliente" className="grid gap-2 border-t pt-3">
          {delivery.reviews.map((r) => (
            <li key={r.id} className="grid gap-1.5 text-sm">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{r.reviewer_name}</span> {r.decision === "aprovado" ? "aprovou" : r.decision === "recusado" ? "recusou" : "comentou"} a versão {r.version}, {formatDateTime(r.created_at)}
              </p>
              {r.comment && <p className="break-words whitespace-pre-wrap">{r.comment}</p>}
              {r.files.map((f) =>
                !f.url ? null : f.kind === "audio" ? (
                  <audio key={f.id} controls preload="metadata" src={f.url} aria-label={`Áudio de ${r.reviewer_name}`} className="w-full" />
                ) : (
                  <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" aria-label="Abrir imagem de referência" className="justify-self-start">
                    {/* eslint-disable-next-line @next/next/no-img-element -- link assinado e temporário do armazenamento privado */}
                    <img src={f.url} alt="Imagem de referência" width={160} height={160} loading="lazy" className="max-h-40 w-auto rounded-md border" />
                  </a>
                ),
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && <DeliveryForm task={task} owners={owners} delivery={delivery} open={editing} onOpenChange={setEditing} onSaved={onChanged} />}
    </li>
  );
}

function LinkBox({ task, link, onChanged }: { task: Task; link: NonNullable<Loaded["link"]>; onChanged: () => void }) {
  const [copied, setCopied] = useState(false);
  const message = `Olá! Segue para sua aprovação: ${task.title}\n${link.url}`;
  const whatsapp = task.lead?.whatsapp_e164 ? whatsappLink(task.lead.whatsapp_e164, message) : `https://wa.me/?text=${encodeURIComponent(message)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      toast.success("Link copiado.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Selecione o endereço e copie manualmente.");
    }
  }

  return (
    <div className="grid gap-2 rounded-lg border bg-muted/40 p-3">
      <Label htmlFor="entrega-link">Link para o cliente</Label>
      <Input id="entrega-link" readOnly value={link.url} onFocus={(e) => e.target.select()} className="text-xs" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void copy()}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copied ? "Copiado" : "Copiar link"}
        </Button>
        <Button asChild size="sm" variant="outline">
          <a href={whatsapp} target="_blank" rel="noopener noreferrer">
            <MessageCircle aria-hidden="true" /> Enviar no WhatsApp
          </a>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <a href={link.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden="true" /> Abrir
          </a>
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Vale até {formatDate(link.expires_at)}.</span>
        <ConfirmDialog
          trigger={
            <Button variant="link" size="sm" className="h-auto p-0 text-xs">
              Gerar outro link
            </Button>
          }
          title="Gerar outro link?"
          description="O link atual para de funcionar. Use se ele foi enviado à pessoa errada."
          confirmLabel="Gerar outro"
          onConfirm={async () => {
            const res = await generateDeliveryLink({ taskId: task.id, rotate: true });
            if (!res.ok) {
              toast.error(res.message);
              return false;
            }
            toast.success(res.message);
            onChanged();
          }}
        />
        <ConfirmDialog
          trigger={
            <Button variant="link" size="sm" className="h-auto p-0 text-xs text-danger">
              Desativar
            </Button>
          }
          title="Desativar o link?"
          description="O cliente não conseguirá mais abrir nem decidir. Dá para gerar outro depois."
          confirmLabel="Desativar"
          onConfirm={async () => {
            const res = await revokeDeliveryLink({ taskId: task.id });
            if (!res.ok) {
              toast.error(res.message);
              return false;
            }
            toast.success(res.message);
            onChanged();
          }}
        />
      </div>
    </div>
  );
}

/** Entregas da tarefa e o link de aprovação do cliente. */
export function TaskDeliveries({ task, owners }: { task: Task; owners: Owner[] }) {
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    const res = await listDeliveries({ taskId: task.id });
    if (res.ok) setData(res.data);
    else setFailed(true);
  }, [task.id]);

  useEffect(() => {
    let active = true;
    void listDeliveries({ taskId: task.id }).then((res) => {
      if (!active) return;
      if (res.ok) setData(res.data);
      else setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [task.id]);

  const changed = () => {
    void load();
    router.refresh();
  };

  // Conteúdo do Estúdio já tem a própria aprovação: duas em paralelo só confundiriam o cliente.
  if (task.content) {
    return (
      <section aria-labelledby="entregas-titulo" className="grid gap-1 text-sm">
        <h3 id="entregas-titulo" className="font-semibold">
          Aprovação do cliente
        </h3>
        <p className="text-muted-foreground">
          Esta tarefa é um conteúdo do Estúdio, e a aprovação acontece{" "}
          <Link href={`/conteudo/${task.content.id}`} className="text-primary hover:underline">
            na tela do conteúdo
          </Link>
          .
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="entregas-titulo" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="entregas-titulo" className="text-sm font-semibold">
          Aprovação do cliente
        </h3>
        {data?.canManage && (
          <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" /> Nova entrega
          </Button>
        )}
      </div>
      {failed && <p className="text-sm text-danger">Não foi possível carregar as entregas. Feche e abra a tarefa de novo.</p>}
      {!data && !failed && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {data && data.deliveries.length === 0 && <p className="text-sm text-muted-foreground">Suba o post, o vídeo ou o documento e gere um link para o cliente aprovar ou recusar.</p>}
      {data && data.deliveries.length > 0 && (
        <ul className="grid gap-2">
          {data.deliveries.map((d) => (
            <DeliveryCard key={d.id} task={task} owners={owners} delivery={d} canManage={data.canManage} onChanged={changed} />
          ))}
        </ul>
      )}
      {data?.canManage &&
        data.deliveries.length > 0 &&
        (data.link ? (
          <LinkBox task={task} link={data.link} onChanged={changed} />
        ) : (
          <Button
            className="justify-self-start"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await generateDeliveryLink({ taskId: task.id, rotate: false });
                if (!res.ok) return void toast.error(res.message);
                await load();
              })
            }
          >
            {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Link2 aria-hidden="true" />} Gerar link para o cliente
          </Button>
        ))}
      {creating && <DeliveryForm task={task} owners={owners} delivery={null} open={creating} onOpenChange={setCreating} onSaved={changed} />}
    </section>
  );
}
