"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, LoaderCircle, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormAlert, FormField } from "@/components/app/form-field";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState } from "@/components/app/states";
import { TAG_COLOR_LABEL, TagChip } from "@/features/crm/components/chips";
import type { TagColor } from "@/features/crm/types";
import { createTag, deleteTag, setTagArchived, updateTag } from "../actions";
import { TAG_COLORS } from "../schemas";
import type { TagRow } from "../queries";

export function TagManager({ tags }: { tags: TagRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = tags.filter((t) => !t.archived_at);
  const archived = tags.filter((t) => t.archived_at);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        if (res.message) toast.success(res.message);
        router.refresh();
      } else toast.error(res.message);
    });
  }

  const row = (t: TagRow) => {
    const uses = t.leads + t.tasks;
    return (
      <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-surface p-3">
        <div className="min-w-0 flex-1">
          <TagChip name={t.name} color={t.color} />
          {t.description && <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {t.tasks} tarefa(s) · {t.leads} lead(s)
          </p>
        </div>
        <div className="flex gap-1">
          <TagFormDialog
            tag={t}
            trigger={
              <Button variant="ghost" size="sm" disabled={pending}>
                <Pencil aria-hidden="true" /> Editar
              </Button>
            }
          />
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setTagArchived({ id: t.id, archived: !t.archived_at }))}>
            {t.archived_at ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />} {t.archived_at ? "Reativar" : "Arquivar"}
          </Button>
          <ConfirmDialog
            tone="danger"
            trigger={
              <Button variant="ghost" size="sm" disabled={pending}>
                <Trash2 aria-hidden="true" /> Excluir
              </Button>
            }
            title={`Excluir a etiqueta “${t.name}”?`}
            description={
              uses
                ? `Ela será removida de ${t.tasks} tarefa(s) e ${t.leads} lead(s). Prefira arquivar para manter o histórico. A exclusão não pode ser desfeita.`
                : "A etiqueta não está em uso. A exclusão não pode ser desfeita."
            }
            confirmLabel="Excluir etiqueta"
            onConfirm={() => run(() => deleteTag({ id: t.id }))}
          />
        </div>
      </li>
    );
  };

  return (
    <div className="grid gap-6">
      <div>
        <TagFormDialog
          trigger={
            <Button>
              <Plus aria-hidden="true" /> Nova etiqueta
            </Button>
          }
        />
      </div>
      {active.length === 0 ? (
        <EmptyState icon={Tags} title="Nenhuma etiqueta ainda" description="Crie etiquetas como Copy, Criação de site, Design ou Tráfego pago para organizar tarefas e leads." />
      ) : (
        <ul className="grid gap-2">{active.map(row)}</ul>
      )}
      {archived.length > 0 && (
        <section aria-labelledby="arquivadas" className="grid gap-2">
          <h2 id="arquivadas" className="flex items-center gap-2 text-sm font-semibold">
            Arquivadas <Badge variant="secondary">{archived.length}</Badge>
          </h2>
          <ul className="grid gap-2 opacity-80">{archived.map(row)}</ul>
        </section>
      )}
    </div>
  );
}

function TagFormDialog({ tag, trigger }: { tag?: TagRow; trigger: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState<TagColor>(tag?.color ?? "teal");
  const [description, setDescription] = useState(tag?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const input = { name, color, description };
      const res = tag ? await updateTag({ ...input, id: tag.id }) : await createTag(input);
      if (!res.ok) {
        setError(res.fieldErrors?.name?.[0] ?? res.message);
        return;
      }
      toast.success(res.message);
      setOpen(false);
      if (!tag) {
        setName("");
        setDescription("");
      }
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tag ? "Editar etiqueta" : "Nova etiqueta"}</DialogTitle>
          <DialogDescription>A pré-visualização mostra como a etiqueta aparece nas tarefas e nos leads.</DialogDescription>
        </DialogHeader>
        <form id="tag-form" onSubmit={submit} className="grid gap-3" noValidate>
          <FormAlert>{error}</FormAlert>
          <FormField label="Nome" required>
            <Input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Criação de site" />
          </FormField>
          <FormField label="Descrição" optional>
            <Textarea rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Cor</legend>
            <div role="radiogroup" aria-label="Cor da etiqueta" className="flex flex-wrap gap-1">
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={TAG_COLOR_LABEL[c]}
                  onClick={() => setColor(c)}
                  className={cn("rounded p-1", color === c && "ring-2 ring-ring")}
                >
                  <TagChip name={TAG_COLOR_LABEL[c]} color={c} />
                </button>
              ))}
            </div>
          </fieldset>
          <p className="text-sm">
            Pré-visualização: <TagChip name={name.trim() || "Etiqueta"} color={color} />
          </p>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form="tag-form" disabled={pending || !name.trim()}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} {tag ? "Salvar" : "Criar etiqueta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
