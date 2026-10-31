"use client";

import { useRef, useState, useTransition } from "react";
import { Download, FileText, LoaderCircle, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/domain/shared/dates";
import { createClient } from "@/lib/supabase/client";
import { deleteAttachment, getAttachmentUrl, listEntityAttachments, registerAttachment, requestUpload } from "../actions";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES, type Attachment } from "../types";

type EntityType = "lead" | "client" | "contract" | "task" | "transaction";

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** Anexos privados: upload por URL assinada; download por link de 60 segundos. */
export function Attachments({ entityType, entityId, initial, canUpload = true, title = "Anexos" }: { entityType: EntityType; entityId: string; initial: Attachment[]; canUpload?: boolean; title?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);

  async function refresh() {
    const res = await listEntityAttachments({ entityType, entityId });
    if (res.ok) setItems(res.data as Attachment[]);
  }

  function upload(files: FileList) {
    startTransition(async () => {
      for (const file of Array.from(files)) {
        if (!ATTACHMENT_TYPES[file.type]) {
          toast.error(`${file.name}: tipo não permitido. Use PDF, imagem, Word, Excel, CSV ou TXT.`);
          continue;
        }
        if (file.size > ATTACHMENT_MAX_BYTES) {
          toast.error(`${file.name}: maior que 15 MB.`);
          continue;
        }
        setProgress(`Enviando ${file.name}…`);
        const req = await requestUpload({ entityType, entityId, fileName: file.name, mimeType: file.type, size: file.size });
        if (!req.ok) {
          toast.error(req.message);
          continue;
        }
        const supabase = createClient();
        const { error } = await supabase.storage.from("attachments").uploadToSignedUrl(req.data.path, req.data.token, file, { contentType: file.type });
        if (error) {
          toast.error(`${file.name}: falha no envio. Tente novamente.`);
          continue;
        }
        const reg = await registerAttachment({ entityType, entityId, fileName: file.name, mimeType: file.type, size: file.size, path: req.data.path });
        if (!reg.ok) toast.error(reg.message);
        else toast.success(`${file.name} anexado.`);
      }
      setProgress(null);
      if (input.current) input.current.value = "";
      await refresh();
    });
  }

  return (
    <section aria-labelledby={`anexos-${entityId}`} className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id={`anexos-${entityId}`} className="text-sm font-semibold">
          {title}
        </h2>
        {canUpload && (
          <>
            <input
              ref={input}
              type="file"
              multiple
              className="sr-only"
              id={`file-${entityId}`}
              accept={Object.keys(ATTACHMENT_TYPES).join(",")}
              onChange={(e) => e.target.files?.length && upload(e.target.files)}
            />
            <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={pending}>
              {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Paperclip aria-hidden="true" />} Anexar arquivo
            </Button>
          </>
        )}
      </div>
      {progress && (
        <p className="text-xs text-muted-foreground" role="status">
          {progress}
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum arquivo. Anexe contratos, comprovantes ou briefings (até 15 MB).</p>
      ) : (
        <ul className="grid gap-1">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-md border bg-surface px-3 py-2 text-sm">
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{a.file_name}</span>
                <span className="text-xs text-muted-foreground">
                  {ATTACHMENT_TYPES[a.mime_type] ?? "Arquivo"} · {size(a.size_bytes)} · {formatDateTime(a.created_at)}
                </span>
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Baixar ${a.file_name}`}
                onClick={async () => {
                  const res = await getAttachmentUrl({ id: a.id });
                  if (res.ok) window.location.assign(res.data.url);
                  else toast.error(res.message);
                }}
              >
                <Download aria-hidden="true" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remover ${a.file_name}`}
                onClick={() =>
                  startTransition(async () => {
                    const res = await deleteAttachment({ id: a.id });
                    if (res.ok) {
                      toast.success(res.message);
                      setItems((l) => l.filter((x) => x.id !== a.id));
                    } else toast.error(res.message);
                  })
                }
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
