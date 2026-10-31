"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, LoaderCircle, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormAlert, FormField } from "@/components/app/form-field";
import { TAG_COLORS } from "@/features/tags/schemas";
import { STAGE_DOT, TAG_COLOR_LABEL } from "./chips";
import { createPipeline, createStage, deleteStage, renamePipeline, reorderStages, updateStage } from "../pipeline-actions";
import type { Pipeline, Stage, StageKind, TagColor } from "../types";

const KIND_LABEL: Record<StageKind, string> = { open: "Aberta", won: "Ganho", lost: "Perdido" };

/** Configuração do funil: etapas (criar, editar, reordenar, excluir) e funis. */
export function PipelineConfig({ pipeline, counts }: { pipeline: Pipeline; counts: Record<string, number> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Stage | "novo" | null>(null);
  const [deleting, setDeleting] = useState<Stage | null>(null);
  const [name, setName] = useState(pipeline.name);
  const [newPipeline, setNewPipeline] = useState("");
  const [pending, startTransition] = useTransition();
  const stages = pipeline.stages;

  function run(fn: () => Promise<{ ok: boolean; message?: string; data?: unknown }>, after?: (data: unknown) => void) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.message);
      if (res.message) toast.success(res.message);
      after?.(res.data);
      router.refresh();
    });
  }

  function move(i: number, dir: -1 | 1) {
    const ids = stages.map((s) => s.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    run(() => reorderStages({ pipelineId: pipeline.id, ids }));
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <Settings2 aria-hidden="true" /> Configurar funil
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Configurar funil</SheetTitle>
          <SheetDescription>Etapas na ordem em que aparecem no quadro. “Ganho” e “Perdido” encerram o negócio.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-6 px-4 pb-6">
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => renamePipeline({ id: pipeline.id, name }));
            }}
          >
            <FormField label="Nome do funil" className="flex-1">
              <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <Button type="submit" variant="outline" disabled={pending || name.trim() === pipeline.name || name.trim().length < 2}>
              Salvar
            </Button>
          </form>

          <section aria-labelledby="etapas" className="grid gap-2">
            <div className="flex items-center justify-between">
              <h3 id="etapas" className="text-sm font-semibold">
                Etapas
              </h3>
              <Button size="sm" onClick={() => setEditing("novo")}>
                <Plus aria-hidden="true" /> Nova etapa
              </Button>
            </div>
            <ol className="grid gap-1.5">
              {stages.map((s, i) => (
                <li key={s.id} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                  <span className={cn("size-2.5 shrink-0 rounded-full", STAGE_DOT[s.color])} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{s.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {KIND_LABEL[s.kind]}
                      {s.sla_days ? ` · alerta após ${s.sla_days} dia(s)` : ""} · {counts[s.id] ?? 0} negócio(s)
                    </span>
                  </span>
                  <Button variant="ghost" size="icon-xs" disabled={pending || i === 0} onClick={() => move(i, -1)} aria-label={`Subir ${s.name}`}>
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" size="icon-xs" disabled={pending || i === stages.length - 1} onClick={() => move(i, 1)} aria-label={`Descer ${s.name}`}>
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => setEditing(s)} aria-label={`Editar ${s.name}`}>
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => setDeleting(s)} aria-label={`Excluir ${s.name}`}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ol>
          </section>

          <form
            className="grid gap-2 border-t pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => createPipeline({ name: newPipeline }),
                (data) => {
                  setNewPipeline("");
                  setOpen(false);
                  const id = (data as { id: string } | undefined)?.id;
                  if (id) router.push(`/crm/funil?funil=${id}`);
                },
              );
            }}
          >
            <h3 className="text-sm font-semibold">Novo funil</h3>
            <div className="flex gap-2">
              <Input value={newPipeline} maxLength={60} placeholder="Ex.: Gestão de redes sociais" onChange={(e) => setNewPipeline(e.target.value)} aria-label="Nome do novo funil" />
              <Button type="submit" variant="outline" disabled={pending || newPipeline.trim().length < 2}>
                Criar
              </Button>
            </div>
          </form>
        </div>
        {editing && <StageDialog pipelineId={pipeline.id} stage={editing === "novo" ? null : editing} onClose={() => setEditing(null)} />}
        {deleting && <DeleteStageDialog stage={deleting} stages={stages} count={counts[deleting.id] ?? 0} onClose={() => setDeleting(null)} />}
      </SheetContent>
    </Sheet>
  );
}

function StageDialog({ pipelineId, stage, onClose }: { pipelineId: string; stage: Stage | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(stage?.name ?? "");
  const [color, setColor] = useState<TagColor>(stage?.color ?? "blue");
  const [kind, setKind] = useState<StageKind>(stage?.kind ?? "open");
  const [sla, setSla] = useState(stage?.sla_days ? String(stage.sla_days) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fields = { name, color, kind, slaDays: sla ? Number(sla) : null };
    startTransition(async () => {
      const res = stage ? await updateStage({ id: stage.id, ...fields }) : await createStage({ pipelineId, ...fields });
      if (!res.ok) return setError(res.fieldErrors?.name?.[0] ?? res.fieldErrors?.slaDays?.[0] ?? res.message);
      toast.success(res.message);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{stage ? "Editar etapa" : "Nova etapa"}</DialogTitle>
          <DialogDescription>O alerta marca negócios parados há mais dias que o informado.</DialogDescription>
        </DialogHeader>
        <form id="stage-form" onSubmit={submit} className="grid gap-3" noValidate>
          <FormAlert>{error}</FormAlert>
          <FormField label="Nome" required>
            <Input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Reunião marcada" />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Tipo">
              <Select value={kind} onValueChange={(v) => setKind(v as StageKind)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Aberta</SelectItem>
                  <SelectItem value="won">Ganho</SelectItem>
                  <SelectItem value="lost">Perdido</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            {kind === "open" && (
              <FormField label="Alerta (dias)" optional>
                <Input type="number" min={1} max={365} inputMode="numeric" value={sla} onChange={(e) => setSla(e.target.value)} />
              </FormField>
            )}
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Cor</legend>
            <div role="radiogroup" aria-label="Cor da etapa" className="flex flex-wrap gap-2">
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={TAG_COLOR_LABEL[c]}
                  onClick={() => setColor(c)}
                  className={cn("flex size-8 items-center justify-center rounded-full border", color === c && "ring-2 ring-ring ring-offset-2 ring-offset-background")}
                >
                  <span className={cn("size-4 rounded-full", STAGE_DOT[c])} />
                </button>
              ))}
            </div>
          </fieldset>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form="stage-form" disabled={pending || name.trim().length < 2}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} {stage ? "Salvar etapa" : "Criar etapa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ARCHIVE = "__arquivar__";

function DeleteStageDialog({ stage, stages, count, onClose }: { stage: Stage; stages: Stage[]; count: number; onClose: () => void }) {
  const router = useRouter();
  const others = stages.filter((s) => s.id !== stage.id);
  const [choice, setChoice] = useState(others.find((s) => s.kind === stage.kind)?.id ?? others[0]?.id ?? ARCHIVE);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await deleteStage({ id: stage.id, targetId: count && choice !== ARCHIVE ? choice : null, archiveDeals: Boolean(count) && choice === ARCHIVE });
      if (!res.ok) return void toast.error(res.message);
      toast.success(res.message);
      onClose();
      router.refresh();
    });
  }

  return (
    <AlertDialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir a etapa “{stage.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {count ? `Ela tem ${count} negócio(s). Escolha para onde eles vão.` : "A etapa está vazia."} O histórico de movimentações para esta etapa deixa de aparecer nos
            relatórios; a exclusão fica registrada na auditoria.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {count > 0 && (
          <RadioGroup value={choice} onValueChange={setChoice} className="grid max-h-64 gap-2 overflow-y-auto">
            {others.map((s) => (
              <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm">
                <RadioGroupItem value={s.id} /> Transferir para “{s.name}” <Badge variant="outline">{KIND_LABEL[s.kind]}</Badge>
              </label>
            ))}
            <label className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm">
              <RadioGroupItem value={ARCHIVE} /> Arquivar os negócios (vão para a lixeira)
            </label>
          </RadioGroup>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Excluir etapa
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
