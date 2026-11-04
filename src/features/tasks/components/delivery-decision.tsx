"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, LoaderCircle, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormAlert } from "@/components/app/form-field";
import { FEEDBACK_IMAGE_ACCEPT, FEEDBACK_MAX_BYTES, FEEDBACK_MAX_IMAGES, type DeliveryStatus } from "@/domain/deliveries";
import { AudioRecorder } from "@/features/inbox/components/composer-tools";
import { createClient } from "@/lib/supabase/client";
import { prepareFeedbackUpload, submitDeliveryReview } from "../delivery-actions";
import { FEEDBACK_BUCKET } from "../delivery-types";

const NAME_KEY = "hub-revisao-nome";

function readName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

const noSubscribe = () => () => {};

function useObjectUrl(blob: Blob) {
  const [url] = useState(() => URL.createObjectURL(blob));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return url;
}

function ImagePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const url = useObjectUrl(file);
  return (
    <li className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element -- prévia local do arquivo escolhido */}
      {url && <img src={url} alt={file.name} width={80} height={80} className="size-20 rounded-md border object-cover" />}
      <Button type="button" variant="secondary" size="icon-xs" className="absolute -top-2 -right-2 rounded-full" aria-label={`Remover ${file.name}`} onClick={onRemove}>
        <X aria-hidden="true" />
      </Button>
    </li>
  );
}

function AudioPreview({ blob, onRemove }: { blob: Blob; onRemove: () => void }) {
  const url = useObjectUrl(blob);
  return (
    <div className="flex items-center gap-2">
      {url && <audio controls src={url} aria-label="Áudio gravado" className="min-w-0 flex-1" />}
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Apagar áudio" onClick={onRemove}>
        <Trash2 aria-hidden="true" />
      </Button>
    </div>
  );
}

export function DeliveryDecision({ token, deliveryId, version, status, title }: { token: string; deliveryId: string; version: number; status: DeliveryStatus; title: string }) {
  const router = useRouter();
  const id = useId();
  // O nome fica guardado neste aparelho para não digitar em cada entrega.
  const saved = useSyncExternalStore(noSubscribe, readName, () => "");
  const [typed, setName] = useState<string | null>(null);
  const name = typed ?? saved;
  const [refusing, setRefusing] = useState(false);
  const [comment, setComment] = useState("");
  const [audio, setAudio] = useState<Blob | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  if (status === "aprovado") return null;
  const refused = status === "recusado";
  const open = refusing || refused;
  const empty = !comment.trim() && !audio && !images.length;

  function pick(list: FileList | null) {
    setError(null);
    const files = Array.from(list ?? []);
    if (files.some((f) => f.size > FEEDBACK_MAX_BYTES)) return setError("Cada imagem pode ter até 15 MB.");
    if (images.length + files.length > FEEDBACK_MAX_IMAGES) setError(`Envie até ${FEEDBACK_MAX_IMAGES} imagens por comentário.`);
    setImages((cur) => [...cur, ...files].slice(0, FEEDBACK_MAX_IMAGES));
  }

  async function upload(blob: Blob) {
    const prep = await prepareFeedbackUpload({ token, deliveryId, mime: blob.type, size: blob.size });
    if (!prep.ok) throw new Error(prep.message);
    const { error: failed } = await createClient().storage.from(FEEDBACK_BUCKET).uploadToSignedUrl(prep.data.path, prep.data.uploadToken, blob, { contentType: prep.data.mime });
    if (failed) throw new Error("Um dos anexos não foi enviado. Confira a conexão e tente de novo.");
    return prep.data.path;
  }

  async function send(decision: "aprovado" | "recusado" | "comentario") {
    setError(null);
    if (name.trim().length < 2) return setError("Informe seu nome.");
    if (decision !== "aprovado" && empty) return setError("Conte o que precisa mudar: escreva, grave um áudio ou envie uma imagem.");
    setPending(true);
    try {
      const paths = decision === "aprovado" ? [] : await Promise.all([...(audio ? [audio] : []), ...images].map(upload));
      const res = await submitDeliveryReview({ token, deliveryId, version, decision, comment: decision === "aprovado" ? "" : comment, name, paths });
      if (!res.ok) {
        setError(res.message ?? "Não foi possível registrar.");
        router.refresh();
        return;
      }
      try {
        localStorage.setItem(NAME_KEY, name.trim());
      } catch {
        // Sem armazenamento no navegador: só pede o nome de novo.
      }
      setDone(res.message ?? "Registrado.");
      setComment("");
      setAudio(null);
      setImages([]);
      setRefusing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível enviar. Tente de novo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-xl border bg-surface p-4">
      <FormAlert>{error}</FormAlert>
      {done && (
        <p role="status" className="rounded-lg border border-success/40 bg-success-soft p-3 text-sm">
          {done}
        </p>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-nome`}>Seu nome</Label>
        <Input id={`${id}-nome`} name="name" value={name} maxLength={120} autoComplete="name" onChange={(e) => setName(e.target.value)} />
      </div>
      {open && (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-comentario`}>{refused ? "Adicionar comentário" : "O que você quer mudar?"}</Label>
            <Textarea id={`${id}-comentario`} name="comentario" rows={4} maxLength={4000} value={comment} placeholder="Ex.: troque a cor do fundo e aumente o logo…" onChange={(e) => setComment(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!audio && <AudioRecorder disabled={pending} onRecorded={(blob) => setAudio(blob)} />}
            <input ref={picker} type="file" accept={FEEDBACK_IMAGE_ACCEPT} multiple hidden aria-label="Imagens de referência" onChange={(e) => (pick(e.target.files), (e.target.value = ""))} />
            <Button type="button" variant="outline" disabled={pending || images.length >= FEEDBACK_MAX_IMAGES} onClick={() => picker.current?.click()}>
              <ImagePlus aria-hidden="true" /> Imagem de referência
            </Button>
            {!audio && <span className="text-xs text-muted-foreground">Toque no microfone para explicar por áudio.</span>}
          </div>
          {audio && <AudioPreview blob={audio} onRemove={() => setAudio(null)} />}
          {images.length > 0 && (
            <ul aria-label="Imagens escolhidas" className="flex flex-wrap gap-3 pt-1">
              {images.map((f, i) => (
                <ImagePreview key={`${f.name}-${i}`} file={f} onRemove={() => setImages((cur) => cur.filter((_, n) => n !== i))} />
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2 *:flex-auto sm:*:flex-none">
        {refusing ? (
          <>
            <Button variant="destructive" disabled={pending} onClick={() => void send("recusado")}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Enviar recusa
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => setRefusing(false)}>
              Voltar
            </Button>
          </>
        ) : refused ? (
          <>
            <Button disabled={pending} onClick={() => void send("comentario")}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Enviar comentário
            </Button>
            <Button variant="outline" disabled={pending} aria-label={`Aprovar ${title}`} onClick={() => void send("aprovado")}>
              Aprovar esta versão
            </Button>
          </>
        ) : (
          <>
            <Button disabled={pending} aria-label={`Aprovar ${title}`} onClick={() => void send("aprovado")}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Aprovar
            </Button>
            <Button variant="outline" disabled={pending} aria-label={`Recusar ${title}`} onClick={() => setRefusing(true)}>
              Recusar
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
