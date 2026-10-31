"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Clock, GripVertical, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatBRL } from "@/domain/shared/money";
import { cn } from "cn";
import { moveDeal } from "../actions";
import { isStale, positionBetween, type BoardCard, type CrmLookups, type Pipeline, type Stage } from "../types";
import { NextContactBadge, STAGE_DOT, TagChip } from "./chips";

const PAGE = 50;

type Columns = Record<string, BoardCard[]>;

function group(cards: BoardCard[], stages: Stage[]): Columns {
  const cols: Columns = Object.fromEntries(stages.map((s) => [s.id, [] as BoardCard[]]));
  for (const c of cards) (cols[c.stage_id] ??= []).push(c);
  for (const k of Object.keys(cols)) cols[k].sort((a, b) => a.position - b.position);
  return cols;
}

export function Board({ pipeline, cards, lookups, canMove }: { pipeline: Pipeline; cards: BoardCard[]; lookups: CrmLookups; canMove: boolean }) {
  const router = useRouter();
  const [columns, setColumns] = useState<Columns>(() => group(cards, pipeline.stages));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Columns | null>(null);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [lost, setLost] = useState<{ card: BoardCard; stageId: string; position: number } | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [, startTransition] = useTransition();

  // Mantém o quadro em sincronia quando o servidor manda dados novos (filtros, refresh).
  // "Agora" fixo por montagem: mantém o render puro (dias parados, SLA).
  const [now] = useState(() => Date.now());
  const [source, setSource] = useState(cards);
  if (source !== cards) {
    setSource(cards);
    setColumns(group(cards, pipeline.stages));
  }

  const stageById = useMemo(() => new Map(pipeline.stages.map((s) => [s.id, s])), [pipeline]);
  const cardById = useMemo(() => new Map(Object.values(columns).flat().map((c) => [c.id, c])), [columns]);
  const ownerById = useMemo(() => new Map(lookups.owners.map((o) => [o.id, o.full_name || o.email])), [lookups]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function findStage(id: string): string | undefined {
    if (columns[id]) return id;
    return Object.keys(columns).find((k) => columns[k].some((c) => c.id === id));
  }

  function persist(card: BoardCard, stageId: string, position: number, before: Columns, lostReasonId?: string, lostNote?: string) {
    startTransition(async () => {
      const res = await moveDeal({ dealId: card.id, stageId, position, lostReasonId, lostNote });
      if (!res.ok) {
        setColumns(before);
        toast.error(res.message);
        return;
      }
      const from = stageById.get(card.stage_id)?.name;
      const to = stageById.get(stageId)?.name;
      if (from !== to) {
        toast.success(`${card.lead.name} movido para ${to}.`, {
          action: {
            label: "Desfazer",
            onClick: async () => {
              const back = await moveDeal({ dealId: card.id, stageId: card.stage_id, position: card.position });
              if (back.ok) router.refresh();
              else toast.error(back.message);
            },
          },
        });
      }
      router.refresh();
    });
  }

  /** Move pelo menu (alternativa ao arrastar). Vai para o topo da coluna. */
  function moveTo(card: BoardCard, stageId: string) {
    if (stageId === card.stage_id) return;
    const before = columns;
    const target = columns[stageId] ?? [];
    const position = positionBetween(null, target[0]?.position ?? null);
    const next: Columns = { ...columns };
    next[card.stage_id] = next[card.stage_id].filter((c) => c.id !== card.id);
    next[stageId] = [{ ...card, stage_id: stageId, position }, ...target];
    if (stageById.get(stageId)?.kind === "lost") {
      setReason("");
      setNote("");
      setSnapshot(before);
      setColumns(next);
      setLost({ card, stageId, position });
      return;
    }
    setColumns(next);
    persist(card, stageId, position, before);
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setSnapshot(columns);
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const from = findStage(String(active.id));
    const to = findStage(String(over.id));
    if (!from || !to || from === to) return;
    setColumns((prev) => {
      const card = prev[from].find((c) => c.id === active.id);
      if (!card) return prev;
      const overIndex = prev[to].findIndex((c) => c.id === over.id);
      const index = overIndex >= 0 ? overIndex : prev[to].length;
      const dest = [...prev[to]];
      dest.splice(index, 0, { ...card, stage_id: to });
      return { ...prev, [from]: prev[from].filter((c) => c.id !== active.id), [to]: dest };
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveId(null);
    const before = snapshot ?? columns;
    setSnapshot(null);
    if (!over) {
      setColumns(before);
      return;
    }
    const stageId = findStage(String(active.id));
    if (!stageId) return;
    const original = Object.values(before).flat().find((c) => c.id === active.id);
    if (!original) return;

    let list = [...columns[stageId]];
    const oldIndex = list.findIndex((c) => c.id === active.id);
    const overIndex = list.findIndex((c) => c.id === over.id);
    if (overIndex >= 0 && oldIndex !== overIndex) {
      const [moved] = list.splice(oldIndex, 1);
      list.splice(overIndex, 0, moved);
    }
    const index = list.findIndex((c) => c.id === active.id);
    const position = positionBetween(list[index - 1]?.position ?? null, list[index + 1]?.position ?? null);
    list = list.map((c) => (c.id === active.id ? { ...c, position } : c));
    const next = { ...columns, [stageId]: list };
    setColumns(next);

    if (stageId === original.stage_id && position === original.position) return;
    if (stageId !== original.stage_id && stageById.get(stageId)?.kind === "lost") {
      setReason("");
      setNote("");
      setSnapshot(before);
      setLost({ card: original, stageId, position });
      return;
    }
    persist(original, stageId, position, before);
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Negócio ${cardById.get(String(active.id))?.lead.name ?? ""} selecionado.`,
    onDragOver: ({ over }) => (over ? `Sobre a etapa ${stageById.get(findStage(String(over.id)) ?? "")?.name ?? ""}.` : "Fora de uma etapa."),
    onDragEnd: ({ over }) => (over ? `Solto na etapa ${stageById.get(findStage(String(over.id)) ?? "")?.name ?? ""}.` : "Movimento cancelado."),
    onDragCancel: () => "Movimento cancelado.",
  };

  const active = activeId ? cardById.get(activeId) : null;

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          if (snapshot) setColumns(snapshot);
          setSnapshot(null);
        }}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: "Para mover, pressione espaço. Use as setas para trocar de etapa e espaço de novo para soltar. Esc cancela.",
          },
        }}
      >
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6" role="list" aria-label={`Etapas do funil ${pipeline.name}`}>
          {pipeline.stages.map((stage) => {
            const list = columns[stage.id] ?? [];
            const limit = limits[stage.id] ?? PAGE;
            const total = list.reduce((s, c) => s + (c.amount_cents ?? 0), 0);
            return (
              <Column key={stage.id} stage={stage} count={list.length} total={total}>
                <SortableContext items={list.slice(0, limit).map((c) => c.id)} strategy={verticalListSortingStrategy}>
                  {list.slice(0, limit).map((card) => (
                    <SortableCard
                      key={card.id}
                      card={card}
                      stage={stage}
                      stages={pipeline.stages}
                      ownerName={card.owner_id ? ownerById.get(card.owner_id) : undefined}
                      canMove={canMove}
                      onMove={moveTo}
                      now={now}
                    />
                  ))}
                </SortableContext>
                {list.length > limit && (
                  <Button variant="ghost" size="sm" onClick={() => setLimits((l) => ({ ...l, [stage.id]: limit + PAGE }))}>
                    Mostrar mais {Math.min(PAGE, list.length - limit)} de {list.length - limit}
                  </Button>
                )}
              </Column>
            );
          })}
        </div>
        <DragOverlay>{active ? <CardView card={active} stage={stageById.get(active.stage_id)} now={now} dragging /> : null}</DragOverlay>
      </DndContext>

      <Dialog
        open={Boolean(lost)}
        onOpenChange={(v) => {
          if (!v && lost) {
            if (snapshot) setColumns(snapshot);
            setSnapshot(null);
            setLost(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Por que {lost?.card.lead.name} foi perdido?</DialogTitle>
            <DialogDescription>O motivo alimenta os relatórios de perda.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="board-lost-reason">Motivo</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="board-lost-reason" className="w-full">
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
              <Label htmlFor="board-lost-note">Detalhes (opcional)</Label>
              <Textarea id="board-lost-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (snapshot) setColumns(snapshot);
                setSnapshot(null);
                setLost(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!reason}
              onClick={() => {
                if (!lost) return;
                persist(lost.card, lost.stageId, lost.position, snapshot ?? columns, reason, note);
                setSnapshot(null);
                setLost(null);
              }}
            >
              Marcar como perdido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Column({ stage, count, total, children }: { stage: Stage; count: number; total: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <section
      role="listitem"
      aria-label={`${stage.name}, ${count} negócio(s)`}
      className={cn("flex w-72 shrink-0 snap-start flex-col rounded-xl bg-muted/60", isOver && "ring-2 ring-ring")}
    >
      <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <span className={cn("size-2 shrink-0 rounded-full", STAGE_DOT[stage.color])} aria-hidden="true" />
          <span className="truncate">{stage.name}</span>
        </h2>
        <span className="tabular text-xs text-muted-foreground">
          {count}
          {total > 0 && ` · ${formatBRL(total)}`}
        </span>
      </header>
      <div ref={setNodeRef} className="grid min-h-24 content-start gap-2 px-2 pb-3">
        {count === 0 && <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">Solte um negócio aqui</p>}
        {children}
      </div>
    </section>
  );
}

function SortableCard({
  card,
  stage,
  stages,
  ownerName,
  canMove,
  onMove,
  now,
}: {
  card: BoardCard;
  stage: Stage;
  stages: Stage[];
  ownerName?: string;
  canMove: boolean;
  onMove: (card: BoardCard, stageId: string) => void;
  now: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, disabled: !canMove });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && "opacity-40")}>
      <CardView
        card={card}
        stage={stage}
        ownerName={ownerName}
        now={now}
        handle={
          canMove ? (
            <button
              type="button"
              className="-ml-1 cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing"
              aria-label={`Arrastar ${card.lead.name}`}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="size-4" aria-hidden="true" />
            </button>
          ) : null
        }
        menu={
          canMove ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label={`Mover ${card.lead.name} para outra etapa`}>
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Mover para…</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {stages.map((s) => (
                  <DropdownMenuItem key={s.id} disabled={s.id === card.stage_id} onSelect={() => onMove(card, s.id)}>
                    <span className={cn("size-2 rounded-full", STAGE_DOT[s.color])} aria-hidden="true" />
                    {s.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      />
    </div>
  );
}

function CardView({
  card,
  stage,
  ownerName,
  handle,
  menu,
  dragging,
  now,
}: {
  now: number;
  card: BoardCard;
  stage?: Stage;
  ownerName?: string;
  handle?: React.ReactNode;
  menu?: React.ReactNode;
  dragging?: boolean;
}) {
  const stale = stage ? isStale(card.stage_changed_at, stage.sla_days, new Date(now)) : false;
  const days = Math.floor((now - new Date(card.stage_changed_at).getTime()) / 86_400_000);
  return (
    <article className={cn("grid gap-1.5 rounded-lg border bg-surface p-2.5 text-sm shadow-xs", dragging && "rotate-1 shadow-lg")}>
      <div className="flex items-start gap-1">
        {handle}
        <Link href={`/crm/leads/${card.lead.id}`} className="min-w-0 flex-1 font-medium leading-snug hover:underline">
          {card.lead.name}
        </Link>
        {menu}
      </div>
      <p className="truncate text-xs text-muted-foreground">
        {[card.lead.city, card.lead.state].filter(Boolean).join(" – ") || "Sem cidade"}
        {ownerName && ` · ${ownerName}`}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <NextContactBadge at={card.lead.next_contact_at} compact />
        {stale && (
          <span className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning">
            <Clock className="size-3.5" aria-hidden="true" /> Parado há {days} dias
          </span>
        )}
        {card.amount_cents != null && <span className="tabular ml-auto text-xs font-medium">{formatBRL(card.amount_cents)}</span>}
      </div>
      {card.lead.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {card.lead.tags.slice(0, 3).map((t) => (
            <TagChip key={t.id} name={t.name} color={t.color} />
          ))}
        </div>
      )}
    </article>
  );
}
