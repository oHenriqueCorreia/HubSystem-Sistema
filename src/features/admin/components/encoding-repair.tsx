"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { formatDateTime } from "@/domain/shared/dates";
import { applyEncodingFix, revertEncodingFix } from "../maintenance-actions";
import type { EncodingBatch, EncodingFix } from "../maintenance";

const PLACE: Record<string, string> = {
  "activities.content": "Linha do tempo",
  "cadence_steps.instruction": "Instrução de cadência",
  "cadence_steps.message": "Mensagem de cadência",
  "cadence_steps.title": "Etapa de cadência",
  "leads.name": "Nome do lead",
  "leads.notes": "Observações do lead",
  "tasks.title": "Tarefa",
  "messages.body": "Mensagem do WhatsApp",
};

export function EncodingRepair({ preview, batches }: { preview: EncodingFix[]; batches: EncodingBatch[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6">
      <section aria-labelledby="acentos" className="grid gap-3">
        <div className="grid gap-1">
          <h2 id="acentos" className="text-base font-semibold">
            Acentuação corrompida
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Textos gravados com a acentuação trocada, como “â€œ” no lugar de aspas ou “Ã§” no lugar de “ç”. Confira antes e depois. Cada texto alterado ganha uma cópia, e a correção pode ser desfeita.
          </p>
        </div>
        {preview.length === 0 ? (
          <p className="rounded-lg border bg-surface p-3 text-sm">Nenhum texto com acentuação corrompida.</p>
        ) : (
          <>
            <ul className="grid max-h-[28rem] gap-2 overflow-y-auto overscroll-contain rounded-xl border bg-surface p-2">
              {preview.map((p) => (
                <li key={`${p.table_name}.${p.column_name}.${p.row_id}`} className="grid gap-1 rounded-lg border bg-background p-3 text-sm">
                  <span className="text-xs text-muted-foreground">{PLACE[`${p.table_name}.${p.column_name}`] ?? `${p.table_name} · ${p.column_name}`}</span>
                  <span className="wrap-break-word">
                    <span className="text-muted-foreground">Antes: </span>
                    <del className="decoration-danger">{p.before}</del>
                  </span>
                  <span className="wrap-break-word">
                    <span className="text-muted-foreground">Depois: </span>
                    <ins className="no-underline">{p.after}</ins>
                  </span>
                </li>
              ))}
            </ul>
            <div>
              <ConfirmDialog
                tone="default"
                trigger={<Button disabled={pending}>Corrigir {preview.length} texto(s)</Button>}
                title={`Corrigir ${preview.length} texto(s)?`}
                description="Só os textos da lista acima mudam. Cada um é copiado antes; se algo ficar errado, use Desfazer logo abaixo."
                confirmLabel="Corrigir textos"
                onConfirm={() => run(() => applyEncodingFix({}))}
              />
            </div>
          </>
        )}
      </section>

      {batches.length > 0 && (
        <section aria-labelledby="correcoes" className="grid gap-2">
          <h2 id="correcoes" className="text-base font-semibold">
            Correções feitas
          </h2>
          <ul className="divide-y rounded-xl border bg-surface">
            {batches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                <span>
                  {b.rows_fixed} texto(s) em {formatDateTime(b.created_at)}
                  {b.created_by_name ? ` por ${b.created_by_name}` : ""}
                  {b.reverted_at ? ` · desfeita em ${formatDateTime(b.reverted_at)}` : ""}
                </span>
                {!b.reverted_at && (
                  <ConfirmDialog
                    tone="danger"
                    trigger={
                      <Button variant="outline" size="sm" disabled={pending}>
                        Desfazer
                      </Button>
                    }
                    title="Desfazer esta correção?"
                    description="Os textos voltam ao que eram antes, menos os que alguém editou depois da correção."
                    confirmLabel="Desfazer correção"
                    onConfirm={() => run(() => revertEncodingFix({ batchId: b.id }))}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
