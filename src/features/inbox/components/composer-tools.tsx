"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Paperclip, Square, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { MEDIA_ACCEPT } from "@/domain/whatsapp/media";
import type { QuickReply } from "@/domain/whatsapp/quick-replies";

export function AttachButton({ disabled, onPick }: { disabled?: boolean; onPick: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={MEDIA_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onPick(file);
        }}
      />
      <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label="Anexar arquivo" onClick={() => input.current?.click()}>
        <Paperclip aria-hidden="true" />
      </Button>
    </>
  );
}

/** Formatos na ordem de preferência: ogg e mp4 também servem na API oficial; webm só no QR Code. */
const RECORD_TYPES = ["audio/ogg;codecs=opus", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
const MAX_SECONDS = 300;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function AudioRecorder({ disabled, onRecorded, onRecording }: { disabled?: boolean; onRecorded: (blob: Blob, mime: string) => void; onRecording?: (on: boolean) => void }) {
  const [seconds, setSeconds] = useState<number | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const discard = useRef(false);
  const onDone = useRef(onRecorded);

  useEffect(() => {
    onDone.current = onRecorded;
  }, [onRecorded]);

  const recording = seconds !== null;

  useEffect(() => {
    onRecording?.(recording);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avisa só quando muda
  }, [recording]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      setSeconds((s) => {
        if (s !== null && s + 1 >= MAX_SECONDS) recorder.current?.stop();
        return s === null ? s : s + 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [recording]);

  // Sair da conversa no meio da gravação desliga o microfone sem enviar nada.
  useEffect(
    () => () => {
      discard.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
    },
    [],
  );

  async function start() {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices) return void toast.error("Este navegador não grava áudio. Envie um arquivo de áudio.");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return void toast.error("Sem acesso ao microfone. Libere o microfone para este site nas permissões do navegador.");
    }
    const mimeType = RECORD_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    discard.current = false;
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      setSeconds(null);
      if (discard.current || !chunks.length) return;
      const mime = rec.mimeType || mimeType || "audio/webm";
      onDone.current(new Blob(chunks, { type: mime }), mime);
    };
    recorder.current = rec;
    rec.start();
    setSeconds(0);
  }

  if (!recording) {
    return (
      <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label="Gravar áudio" onClick={start}>
        <Mic aria-hidden="true" />
      </Button>
    );
  }
  return (
    <div className="flex flex-1 items-center justify-between gap-1 rounded-md bg-danger/10 pl-3 text-sm text-danger" role="status">
      <span className="tabular" aria-label={`Gravando: ${seconds} segundos`}>
        {clock(seconds)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Cancelar gravação"
        onClick={() => {
          discard.current = true;
          recorder.current?.stop();
        }}
      >
        <X aria-hidden="true" />
      </Button>
      <Button type="button" variant="ghost" size="icon" aria-label="Parar e enviar áudio" onClick={() => recorder.current?.stop()}>
        <Square className="fill-current" aria-hidden="true" />
      </Button>
    </div>
  );
}

export function QuickReplyMenu({ id, replies, active, onChoose }: { id: string; replies: QuickReply[]; active: number; onChoose: (reply: QuickReply) => void }) {
  return (
    <ul id={id} role="listbox" aria-label="Respostas rápidas" className="max-h-52 overflow-y-auto rounded-lg border bg-popover p-1 text-sm shadow-md">
      {replies.map((r, i) => (
        <li key={r.id} id={`${id}-${i}`} role="option" aria-selected={i === active}>
          <button
            type="button"
            tabIndex={-1}
            // Evita tirar o foco do campo antes de escolher.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChoose(r)}
            className={cn("grid w-full gap-0.5 rounded-md px-2 py-1.5 text-left", i === active ? "bg-accent" : "hover:bg-accent")}
          >
            <span className="font-medium">/{r.shortcut}</span>
            <span className="truncate text-xs text-muted-foreground">{r.body}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
