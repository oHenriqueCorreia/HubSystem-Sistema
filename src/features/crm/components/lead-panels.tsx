"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Check, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { formatBRL, parseBRL } from "@/domain/shared/money";
import {
  addActivity,
  assignLead,
  deleteLead,
  moveDeal,
  restoreLead,
  setLeadTags,
  setNextContact,
  startDealInPipeline,
  updateDealValue,
} from "../actions";
import { TagPicker } from "@/features/tags/components/tag-picker";
import { NextContactBadge, StageLabel, TagChip } from "./chips";
import type { CrmLookups, Deal, Tag } from "../types";

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function daysFromNow(days: number, hour = 9) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

/** Faixa "Próxima ação": o elemento de destaque da tela do lead. */
export function NextActionPanel({ leadId, at, canEdit }: { leadId: string; at: string | null; canEdit: boolean }) {
  const [pending, startTransition] = useTransition();
  const [custom, setCustom] = useState(toLocalInput(at));

  function save(iso: string | null) {
    startTransition(async () => {
      const res = await setNextContact({ leadId, at: iso });
      if (res.ok) {
        toast.success(res.message);
      } else toast.error(res.message);
    });
  }

  return (
    <section aria-labelledby="proxima-acao" className="rounded-xl border-l-4 border-signal bg-signal-soft/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="proxima-acao" className="text-sm font-semibold">
          Próxima ação
        </h2>
        <NextContactBadge at={at} />
      </div>
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Agendar contato:</span>
          {[
            { label: "Amanhã", d: 1 },
            { label: "Em 3 dias", d: 3 },
            { label: "Em 1 semana", d: 7 },
          ].map((o) => (
            <Button key={o.d} size="sm" variant="outline" className="bg-background" disabled={pending} onClick={() => save(daysFromNow(o.d))}>
              {o.label}
            </Button>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="bg-background" disabled={pending}>
                <CalendarPlus aria-hidden="true" /> Escolher data
              </Button>
            </PopoverTrigger>
            <PopoverContent className="grid w-72 gap-2">
              <Label htmlFor="next-at">Data e hora</Label>
              <Input id="next-at" type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} />
              <Button size="sm" disabled={!custom || pending} onClick={() => save(new Date(custom).toISOString())}>
                Agendar
              </Button>
            </PopoverContent>
          </Popover>
          {at && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => save(null)}>
              Limpar
            </Button>
          )}
          {pending && <LoaderCircle className="size-4 animate-spin" aria-label="Salvando" />}
        </div>
      )}
    </section>
  );
}

const ACTIVITY_OPTIONS = [
  { value: "nota", label: "Nota" },
  { value: "ligacao", label: "Ligação" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "E-mail" },
  { value: "reuniao", label: "Reunião" },
] as const;

export function ActivityComposer({ leadId, dealId }: { leadId: string; dealId: string | null }) {
  const [type, setType] = useState<(typeof ACTIVITY_OPTIONS)[number]["value"]>("nota");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) {
      setError("Escreva o que aconteceu.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await addActivity({ leadId, dealId, type, content });
      if (res.ok) {
        setContent("");
        toast.success(res.message);
      } else setError(res.message);
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-2 rounded-xl border bg-surface p-3" aria-label="Registrar interação">
      <ToggleGroup type="single" value={type} onValueChange={(v) => v && setType(v as typeof type)} variant="outline" size="sm" className="flex-wrap" aria-label="Tipo de interação">
        {ACTIVITY_OPTIONS.map((o) => (
          <ToggleGroupItem key={o.value} value={o.value}>
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Label htmlFor="activity-content" className="sr-only">
        Descrição
      </Label>
      <Textarea
        id="activity-content"
        rows={2}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="O que foi conversado? Próximos passos?"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "activity-error" : undefined}
      />
      {error && (
        <p id="activity-error" role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" className="justify-self-end" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
        Registrar
      </Button>
    </form>
  );
}

/** Etapa e valores do negócio em cada funil. */
export function DealPanel({
  leadId,
  deals,
  lookups,
  canMove,
  canEdit,
}: {
  leadId: string;
  deals: Deal[];
  lookups: CrmLookups;
  canMove: boolean;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [lostFor, setLostFor] = useState<{ deal: Deal; stageId: string } | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const missing = lookups.pipelines.filter((p) => !deals.some((d) => d.pipeline_id === p.id));

  function move(deal: Deal, stageId: string, lostReasonId?: string, lostNote?: string) {
    startTransition(async () => {
      const res = await moveDeal({ dealId: deal.id, stageId, position: deal.position, lostReasonId, lostNote });
      if (res.ok) {
        toast.success(res.message);
        setLostFor(null);
      } else toast.error(res.message);
    });
  }

  function onStage(deal: Deal, stageId: string) {
    const stage = lookups.pipelines.flatMap((p) => p.stages).find((s) => s.id === stageId);
    if (stage?.kind === "lost") {
      setReason("");
      setNote("");
      setLostFor({ deal, stageId });
    } else move(deal, stageId);
  }

  return (
    <section aria-labelledby="negocios" className="grid gap-3">
      <h2 id="negocios" className="text-sm font-semibold">
        Funil
      </h2>
      {deals.map((deal) => {
        const pipeline = lookups.pipelines.find((p) => p.id === deal.pipeline_id);
        const stage = pipeline?.stages.find((s) => s.id === deal.stage_id);
        return (
          <div key={deal.id} className="grid gap-2 rounded-lg border bg-surface p-3">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{pipeline?.name}</span>
              {deal.amount_cents != null && <span className="tabular font-medium text-foreground">{formatBRL(deal.amount_cents)}{deal.billing === "mensal" ? "/mês" : ""}</span>}
            </div>
            {canMove ? (
              <Select value={deal.stage_id} onValueChange={(v) => onStage(deal, v)} disabled={pending}>
                <SelectTrigger className="w-full" aria-label={`Etapa no funil ${pipeline?.name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pipeline?.stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <StageLabel name={s.name} color={s.color} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              stage && <StageLabel name={stage.name} color={stage.color} />
            )}
            {deal.lost_reason_id && (
              <p className="text-xs text-danger">
                Motivo da perda: {lookups.lostReasons.find((r) => r.id === deal.lost_reason_id)?.name}
                {deal.lost_note ? ` — ${deal.lost_note}` : ""}
              </p>
            )}
            {canEdit && <DealValueEditor deal={deal} />}
          </div>
        );
      })}
      {canEdit && missing.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {missing.map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await startDealInPipeline({ leadId, pipelineId: p.id });
                  if (res.ok) {
                    toast.success(res.message);
                  } else toast.error(res.message);
                })
              }
            >
              <Plus aria-hidden="true" /> Adicionar em {p.name}
            </Button>
          ))}
        </div>
      )}

      <Dialog open={Boolean(lostFor)} onOpenChange={(v) => !v && setLostFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar como perdido</DialogTitle>
            <DialogDescription>O motivo ajuda a entender onde o funil está perdendo negócios.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="lost-reason">Motivo</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="lost-reason" className="w-full">
                  <SelectValue placeholder="Escolha o motivo" />
                </SelectTrigger>
                <SelectContent>
                  {lookups.lostReasons.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lost-note">Detalhes (opcional)</Label>
              <Textarea id="lost-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostFor(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={!reason || pending} onClick={() => lostFor && move(lostFor.deal, lostFor.stageId, reason, note)}>
              Marcar como perdido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function DealValueEditor({ deal }: { deal: Deal }) {
  const [value, setValue] = useState(deal.amount_cents != null ? (deal.amount_cents / 100).toFixed(2).replace(".", ",") : "");
  const [billing, setBilling] = useState<string>(deal.billing ?? "unico");
  const [date, setDate] = useState(deal.expected_close_date ?? "");
  const [pending, startTransition] = useTransition();
  const cents = value ? parseBRL(value) : null;
  const invalid = Boolean(value) && cents === null;

  return (
    <details className="group text-sm">
      <summary className="cursor-pointer text-xs text-primary">Valor e previsão de fechamento</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor={`v-${deal.id}`} className="text-xs">
            Valor (R$)
          </Label>
          <Input id={`v-${deal.id}`} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={invalid || undefined} placeholder="0,00" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`b-${deal.id}`} className="text-xs">
            Cobrança
          </Label>
          <Select value={billing} onValueChange={setBilling}>
            <SelectTrigger id={`b-${deal.id}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unico">Pagamento único</SelectItem>
              <SelectItem value="mensal">Mensal</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`d-${deal.id}`} className="text-xs">
            Previsão
          </Label>
          <Input id={`d-${deal.id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <Button
        size="sm"
        className="mt-2"
        disabled={invalid || pending}
        onClick={() =>
          startTransition(async () => {
            const res = await updateDealValue({
              dealId: deal.id,
              amountCents: cents,
              billing: billing as "unico" | "mensal",
              expectedCloseDate: date || null,
            });
            if (res.ok) {
              toast.success(res.message);
            } else toast.error(res.message);
          })
        }
      >
        <Check aria-hidden="true" /> Salvar valores
      </Button>
    </details>
  );
}

export function OwnerSelect({ leadId, ownerId, lookups }: { leadId: string; ownerId: string | null; lookups: CrmLookups }) {
  const [pending, startTransition] = useTransition();
  return (
    <Select
      value={ownerId ?? "sem"}
      disabled={pending}
      onValueChange={(v) =>
        startTransition(async () => {
          const res = await assignLead({ leadId, ownerId: v === "sem" ? null : v });
          if (res.ok) {
            toast.success(res.message);
          } else toast.error(res.message);
        })
      }
    >
      <SelectTrigger className="w-full" aria-label="Responsável">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="sem">Sem responsável</SelectItem>
        {lookups.owners.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.full_name || o.email}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TagEditor({ leadId, current, all, canEdit }: { leadId: string; current: Tag[]; all: Tag[]; canEdit: boolean }) {
  const [selected, setSelected] = useState(() => current.map((t) => t.id));
  const [pending, startTransition] = useTransition();
  // Etiquetas arquivadas que o lead já tem continuam visíveis.
  const options = [...all, ...current.filter((c) => !all.some((t) => t.id === c.id))];

  function save(next: string[]) {
    setSelected(next);
    startTransition(async () => {
      const res = await setLeadTags({ leadId, tagIds: next });
      if (!res.ok) toast.error(res.message);
    });
  }

  if (!canEdit) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {current.map((t) => (
          <TagChip key={t.id} name={t.name} color={t.color} />
        ))}
        {current.length === 0 && <span className="text-sm text-muted-foreground">Sem etiquetas</span>}
      </div>
    );
  }
  return <TagPicker value={selected} onChange={save} options={options} disabled={pending} />;
}

export function DeleteLeadButton({ leadId, name }: { leadId: string; name: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" className="text-danger">
          <Trash2 aria-hidden="true" /> Excluir
        </Button>
      }
      title={`Excluir “${name}”?`}
      description="O lead vai para a lixeira e some das listas e do funil. Você pode desfazer logo em seguida."
      confirmLabel="Excluir lead"
      onConfirm={async () => {
        const res = await deleteLead({ id: leadId });
        if (!res.ok) {
          toast.error(res.message);
          return false;
        }
        router.push("/crm/leads");
        toast.success("Lead excluído.", {
          duration: 8000,
          action: {
            label: "Desfazer",
            onClick: async () => {
              const r = await restoreLead({ id: leadId });
              if (r.ok) {
                toast.success("Lead restaurado.");
                router.push(`/crm/leads/${leadId}`);
              } else toast.error(r.message);
            },
          },
        });
      }}
    />
  );
}
