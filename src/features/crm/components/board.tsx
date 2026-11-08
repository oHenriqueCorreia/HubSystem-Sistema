"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
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
import { CalendarPlus, Clock, ExternalLink, GripVertical, ListPlus, MapPin, MessageCircle, MoreHorizontal } from "lucide-react";
import { TaskFormDialog } from "@/features/tasks/components/task-form-dialog";
import { EventDialog } from "@/features/tasks/components/event-dialog";
import { todayLocal } from "@/domain/shared/dates";
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
import { formatPhone } from "@/domain/shared/phone";
import { formatRelative } from "@/domain/shared/dates";
import { leadMapsUrl } from "@/domain/crm/maps";
import { cn } from "cn";
import { DRAG_MOVE, DROP_ANIMATION, pointerFirst } from "@/lib/dnd";
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

// Devagar o bastante para soltar na etapa vizinha: o padrão atravessa o quadro inteiro em menos de um segundo.
const AUTO_SCROLL = { acceleration: 4, interval: 12, threshold: { x: 0.15, y: 0.15 } };

/** O que a pessoa pode criar a partir do cartão: tarefa (cai em Tarefas) e compromisso (cai na Agenda). */
export type BoardWork = { meId: string; canTask: boolean; assignTask: boolean; canSchedule: boolean; assignCalendar: boolean };
type WorkKind = "tarefa" | "agenda";

export function Board({ pipeline, cards, lookups, canMove, work }: { pipeline: Pipeline; cards: BoardCard[]; lookups: CrmLookups; canMove: boolean; work?: BoardWork }) {
  const router = useRouter();
  const [workFor, setWorkFor] = useState<{ kind: WorkKind; lead: { id: string; name: string } } | null>(null);
  const onWork = useCallback((card: BoardCard, kind: WorkKind) => setWorkFor({ kind, lead: { id: card.lead.id, name: card.lead.name } }), []);
  const [columns, setColumns] = useState<Columns>(() => group(cards, pipeline.stages));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Columns | null>(null);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [lost, setLost] = useState<{ card: BoardCard; stageId: string; position: number } | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [saving, startTransition] = useTransition();

  // Mantém o quadro em sincronia quando o servidor manda dados novos (filtros, refresh).
  // "Agora" fixo por montagem: mantém o render puro (dias parados, SLA).
  const [now] = useState(() => Date.now());
  const [source, setSource] = useState(cards);
  // Dados novos do servidor esperam: no meio de um arraste, de um salvamento ou do motivo de perda, fariam os cartões pularem.
  if (!activeId && !saving && !lost && source !== cards) {
    setSource(cards);
    setColumns(group(cards, pipeline.stages));
  }

  const stageById = useMemo(() => new Map(pipeline.stages.map((s) => [s.id, s])), [pipeline]);
  const cardById = useMemo(() => new Map(Object.values(columns).flat().map((c) => [c.id, c])), [columns]);
  const ownerById = useMemo(() => new Map(lookups.owners.map((o) => [o.id, o.full_name || o.email])), [lookups]);

  const sensors = useSensors(
    // Mouse e toque separados: assim o dedo que só quer rolar a tela não pega o cartão.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
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
        router.refresh();
        return;
      }
      const from = stageById.get(card.stage_id)?.name;
      const to = stageById.get(stageId)?.name;
      if (from !== to && stageById.get(stageId)?.kind === "won") {
        toast.success(`${card.lead.name}: negócio fechado!`, {
          duration: 10000,
          action: { label: "Converter em cliente", onClick: () => router.push(`/crm/leads/${card.lead.id}`) },
        });
      } else if (from !== to) {
        toast.success(`${card.lead.name} movido para ${to}.`, {
          action: {
            label: "Desfazer",
            onClick: async () => {
              const back = await moveDeal({ dealId: card.id, stageId: card.stage_id, position: card.position });
              if (!back.ok) toast.error(back.message);
            },
          },
        });
      }
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

  // Referência fixa para o menu dos cartões: sem ela, todo cartão seria redesenhado a cada mudança no quadro.
  const moveToRef = useRef(moveTo);
  useEffect(() => {
    moveToRef.current = moveTo;
  });
  const onMove = useCallback((card: BoardCard, stageId: string) => moveToRef.current(card, stageId), []);

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setSnapshot(columns);
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
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
    if (stageId === original.stage_id && index === before[stageId].findIndex((c) => c.id === active.id)) {
      setColumns(before);
      return;
    }
    const position = positionBetween(list[index - 1]?.position ?? null, list[index + 1]?.position ?? null);
    list = list.map((c) => (c.id === active.id ? { ...c, position } : c));
    const next = { ...columns, [stageId]: list };
    setColumns(next);

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
  const activeStage = activeId ? findStage(activeId) : null;

  return (
    <>
      <DndContext
        sensors={sensors}
        autoScroll={AUTO_SCROLL}
        collisionDetection={pointerFirst}
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
        <div className={cn("-mx-4 flex scroll-pl-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pb-4 sm:-mx-6 sm:px-6", !activeId && "snap-x snap-mandatory sm:snap-none")} role="list" aria-label={`Etapas do funil ${pipeline.name}`}>
          {pipeline.stages.map((stage) => {
            const list = columns[stage.id] ?? [];
            const limit = limits[stage.id] ?? PAGE;
            const total = list.reduce((s, c) => s + (c.amount_cents ?? 0), 0);
            return (
              <Column key={stage.id} stage={stage} count={list.length} total={total} highlighted={activeStage === stage.id}>
                <SortableContext items={list.slice(0, limit).map((c) => c.id)} strategy={verticalListSortingStrategy}>
                  {list.slice(0, limit).map((card) => (
                    <SortableCard
                      key={card.id}
                      card={card}
                      stage={stage}
                      stages={pipeline.stages}
                      ownerName={card.owner_id ? ownerById.get(card.owner_id) : undefined}
                      canMove={canMove}
                      onMove={onMove}
                      onWork={work && (work.canTask || work.canSchedule) ? onWork : undefined}
                      work={work}
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
        <DragOverlay dropAnimation={reducedMotion ? null : DROP_ANIMATION}>
          {active ? (
            // A medida vem do primeiro elemento: inclinado, ele confundiria as setas do teclado (a mesma etapa pareceria estar ao lado).
            <div inert>
              <CardView card={active} stage={stageById.get(active.stage_id)} now={now} dragging />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Tarefa cai em Tarefas; compromisso cai na Agenda (e no Google Agenda, se conectado). */}
      {work && workFor?.kind === "tarefa" && (
        <TaskFormDialog
          key={`tarefa-${workFor.lead.id}`}
          owners={lookups.owners}
          canAssign={work.assignTask}
          defaults={{ lead: workFor.lead }}
          open
          onOpenChange={(v) => !v && setWorkFor(null)}
        />
      )}
      {work && workFor?.kind === "agenda" && (
        <EventDialog
          key={`agenda-${workFor.lead.id}`}
          open
          onOpenChange={(v) => !v && setWorkFor(null)}
          draft={{ date: todayLocal(), time: "10:00", lead: workFor.lead }}
          owners={lookups.owners}
          canAssign={work.assignCalendar}
          meId={work.meId}
        />
      )}

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

function Column({ stage, count, total, highlighted, children }: { stage: Stage; count: number; total: number; highlighted: boolean; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: stage.id });
  return (
    <section
      role="listitem"
      aria-label={`${stage.name}, ${count} negócio(s)`}
      className={cn("flex max-h-[calc(100dvh-15rem)] w-[min(18rem,85vw)] shrink-0 snap-start flex-col rounded-xl bg-muted/60", highlighted && "ring-2 ring-ring")}
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
      <div ref={setNodeRef} className="grid min-h-24 flex-1 content-start gap-2 overflow-y-auto overscroll-y-contain px-2 pb-3">
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
  onWork,
  work,
  now,
}: {
  card: BoardCard;
  stage: Stage;
  stages: Stage[];
  ownerName?: string;
  canMove: boolean;
  onMove: (card: BoardCard, stageId: string) => void;
  onWork?: (card: BoardCard, kind: WorkKind) => void;
  work?: BoardWork;
  now: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, disabled: !canMove, transition: DRAG_MOVE });
  const leadName = card.lead.name;
  // O cartão inteiro arrasta (como nas Tarefas); o ícone só indica que dá para arrastar.
  const handle = useMemo(
    () =>
      canMove ? (
        <span className="-ml-1 rounded p-1 text-muted-foreground" aria-hidden="true">
          <GripVertical className="size-4" />
        </span>
      ) : null,
    [canMove],
  );
  const menu = useMemo(
    () =>
      canMove || onWork ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label={`Ações de ${card.lead.name}`}>
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onWork && work?.canTask && (
                  <DropdownMenuItem onSelect={() => onWork(card, "tarefa")}>
                    <ListPlus aria-hidden="true" /> Criar tarefa
                  </DropdownMenuItem>
                )}
                {onWork && work?.canSchedule && (
                  <DropdownMenuItem onSelect={() => onWork(card, "agenda")}>
                    <CalendarPlus aria-hidden="true" /> Agendar compromisso
                  </DropdownMenuItem>
                )}
                {(card.lead.whatsapp_e164 || card.lead.phone_e164) && (
                  <DropdownMenuItem asChild>
                    <Link href={`/atendimento?situacao=todas&q=${encodeURIComponent((card.lead.whatsapp_e164 ?? card.lead.phone_e164 ?? "").replace(/\D/g, "").slice(-8))}`}>
                      <MessageCircle aria-hidden="true" /> Abrir conversa
                    </Link>
                  </DropdownMenuItem>
                )}
                {canMove && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Mover para…</DropdownMenuLabel>
                    {stages.map((s) => (
                      <DropdownMenuItem key={s.id} disabled={s.id === card.stage_id} onSelect={() => onMove(card, s.id)}>
                        <span className={cn("size-2 rounded-full", STAGE_DOT[s.color])} aria-hidden="true" />
                        {s.name}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
      ) : null,
    [canMove, card, stages, onMove, onWork, work],
  );
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(canMove && "cursor-grab active:cursor-grabbing pointer-coarse:select-none [-webkit-touch-callout:none]", isDragging && "opacity-30")}
      // Segurar o dedo pega o cartão: o menu do aparelho interromperia o arraste.
      onContextMenu={(e) => {
        if (window.matchMedia("(pointer: coarse)").matches) e.preventDefault();
      }}
      {...attributes}
      {...listeners}
      // Teclado: só arrasta com o foco no próprio cartão (Enter num link dentro dele abre o link).
      onKeyDown={(e) => {
        if (e.target === e.currentTarget) listeners?.onKeyDown?.(e);
      }}
      aria-label={canMove ? `${leadName}: arraste para mudar de etapa` : undefined}
    >
      <CardView card={card} stage={stage} ownerName={ownerName} now={now} handle={handle} menu={menu} />
    </div>
  );
}

const CardView = memo(function CardView({
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
      {(card.lead.phone_e164 || card.lead.email) && (
        <p className="truncate text-xs text-muted-foreground">
          {[card.lead.phone_e164 ? formatPhone(card.lead.phone_e164) : null, card.lead.email].filter(Boolean).join(" · ")}
        </p>
      )}
      {card.lead.last_contact_at && <p className="text-xs text-muted-foreground">Último contato {formatRelative(card.lead.last_contact_at)}</p>}
      {!dragging && (
        <a
          href={leadMapsUrl(card.lead)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          aria-label={`Abrir ${card.lead.name} no Google Maps (nova aba)`}
        >
          <MapPin className="size-3.5" aria-hidden="true" /> Abrir no Google Maps <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      )}
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
});
