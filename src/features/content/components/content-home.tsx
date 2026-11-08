"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronLeft, ChevronRight, LoaderCircle, Plug, Plus, RefreshCw, Sparkles, Unplug } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormAlert, FormField } from "@/components/app/form-field";
import { EmptyState } from "@/components/app/states";
import { dayKey, minutesOfDay } from "@/domain/calendar";
import { addDays, listDays, monthRange } from "@/domain/calendar/agenda";
import { CONTENT_STATUS_LABEL, PLATFORM_LABEL, SCHEDULE_STATUS_LABEL, type ContentStatus } from "@/domain/content";
import { formatDate, formatDateTime } from "@/domain/shared/dates";
import { getWorkspaceOptions } from "@/features/tasks/actions";
import type { TaskBoard, TaskColumn } from "@/features/tasks/types";
import { createContentTask, disconnectSocial, setSocialSelected } from "../actions";
import { IntegrationGuide } from "@/features/integrations/components/integration-guide";
import type { ContentCard, ScheduleRow, SocialAccount } from "../queries";
import { ContentStatusBadge } from "./content-status";
import { AccountAvatar } from "./studio";

type Owner = { id: string; full_name: string; email: string };
type Connection = { status: string; external_user: string; expires_at: string | null; last_error: string | null } | null;
const NONE = "__nenhum__";
const CONNECTION_LABEL: Record<string, string> = { ativa: "Conectada", expirada: "Acesso expirado", erro: "Com erro", revogada: "Acesso revogado" };

export function NewContentDialog({ owners, campaigns, canAssign }: { owners: Owner[]; campaigns: { id: string; name: string }[]; canAssign: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [boards, setBoards] = useState<TaskBoard[]>([]);
  const [lists, setLists] = useState<TaskColumn[]>([]);
  const [clients, setClients] = useState<{ id: string; legal_name: string }[]>([]);
  const [clientId, setClientId] = useState("");
  const [boardId, setBoardId] = useState("");
  const [columnId, setColumnId] = useState("");
  const [ownerId, setOwnerId] = useState(NONE);
  const [campaignId, setCampaignId] = useState(NONE);
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void getWorkspaceOptions({}).then((res) => {
      if (!alive || !res.ok) return;
      setBoards(res.data.boards);
      setLists(res.data.lists);
      setClients(res.data.clients);
      setBoardId((cur) => cur || res.data.boards[0]?.id || "");
    });
    return () => {
      alive = false;
    };
  }, [open]);

  const boardLists = lists.filter((l) => l.board_id === boardId && l.kind !== "concluida" && l.kind !== "cancelada");

  function pickClient(id: string) {
    setClientId(id);
    const own = boards.find((b) => b.client_id === id);
    if (own) {
      setBoardId(own.id);
      setColumnId("");
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createContentTask({
        title,
        description,
        clientId,
        columnId: columnId || boardLists[0]?.id,
        ownerId: ownerId === NONE ? null : ownerId,
        campaignId: campaignId === NONE ? null : campaignId,
        dueDate: dueDate || null,
        dueTime: dueTime || null,
      });
      if (!res.ok) return setError(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message);
      toast.success(res.message);
      setOpen(false);
      router.push(`/conteudo/${res.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden="true" /> Nova produção
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova tarefa de produção</DialogTitle>
          <DialogDescription>A tarefa aparece no quadro escolhido e, com data, na agenda.</DialogDescription>
        </DialogHeader>
        <form id="content-form" onSubmit={submit} className="grid gap-3" noValidate>
          <FormAlert>{error}</FormAlert>
          <FormField label="Título" required>
            <Input autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Post da promoção de novembro…" />
          </FormField>
          <FormField label="Cliente" required>
            <Select value={clientId} onValueChange={pickClient}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={clients.length ? "Escolha o cliente" : "Nenhum cliente cadastrado"} />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.legal_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Quadro" required>
              <Select
                value={boardId}
                onValueChange={(v) => {
                  setBoardId(v);
                  setColumnId("");
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Escolha o quadro" />
                </SelectTrigger>
                <SelectContent>
                  {boards.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Lista" required>
              <Select value={columnId || boardLists[0]?.id || ""} onValueChange={setColumnId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Escolha a lista" />
                </SelectTrigger>
                <SelectContent>
                  {boardLists.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          {canAssign && (
            <FormField label="Responsável">
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Eu mesmo</SelectItem>
                  {owners.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.full_name || o.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
          {campaigns.length > 0 && (
            <FormField label="Campanha" optional>
              <Select value={campaignId} onValueChange={setCampaignId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nenhuma</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Prazo" optional>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </FormField>
            <FormField label="Horário" optional>
              <Input type="time" value={dueTime} disabled={!dueDate} onChange={(e) => setDueTime(e.target.value)} />
            </FormField>
          </div>
          <FormField label="Briefing" optional>
            <Textarea rows={3} value={description} maxLength={10000} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form="content-form" disabled={pending || !title.trim() || !clientId || !boardLists.length}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Criar produção
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ContentList({ items, statusFilter, hrefs }: { items: ContentCard[]; statusFilter?: string; hrefs: { all: string; status: string } }) {
  const onFilterHref = (status?: string) => (status ? `${hrefs.status}${status}` : hrefs.all);
  return (
    <div className="grid gap-3">
      <nav aria-label="Filtrar por situação" className="flex gap-1 overflow-x-auto">
        <Link href={onFilterHref()} aria-current={!statusFilter ? "page" : undefined} className={cn("rounded-md px-2 py-1 text-sm whitespace-nowrap", !statusFilter ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
          Todas
        </Link>
        {(Object.keys(CONTENT_STATUS_LABEL) as ContentStatus[]).map((s) => (
          <Link key={s} href={onFilterHref(s)} aria-current={statusFilter === s ? "page" : undefined} className={cn("rounded-md px-2 py-1 text-sm whitespace-nowrap", statusFilter === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
            {CONTENT_STATUS_LABEL[s]}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <EmptyState icon={Sparkles} title={statusFilter ? "Nada nesta situação" : "Nenhuma produção ainda"} description="Crie uma tarefa de produção, anexe as imagens, escreva a legenda e envie o link para o cliente aprovar." />
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {items.map((c) => (
            <li key={c.id} className="min-w-0">
              <Link href={`/conteudo/${c.id}`} className="grid gap-1 rounded-lg border bg-surface p-3 text-sm transition-colors hover:border-primary">
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0 font-medium break-words">{c.task?.title ?? "Conteúdo"}</span>
                  <ContentStatusBadge status={c.status} className="shrink-0" />
                </span>
                <span className="text-xs break-words text-muted-foreground">
                  {[c.client?.legal_name, c.board && (c.list ? `${c.board} › ${c.list}` : c.board), c.task?.due_at && `Prazo ${formatDate(c.task.due_at)}`].filter(Boolean).join(", ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const utc = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { ...o, timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
const hhmm = (iso: string) => {
  const m = minutesOfDay(iso);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export function ContentCalendar({ month, schedules, today, hrefBase }: { month: string; schedules: ScheduleRow[]; today: string; hrefBase: string }) {
  const hrefFor = (m: string) => `${hrefBase}${m}`;
  const range = monthRange(`${month}-15`);
  const days = listDays(range.from, range.to);
  const prev = addDays(`${month}-01`, -1).slice(0, 7);
  const next = addDays(`${month}-28`, 7).slice(0, 7);
  const byDay = new Map<string, ScheduleRow[]>();
  for (const s of schedules) byDay.set(dayKey(s.scheduled_at), [...(byDay.get(dayKey(s.scheduled_at)) ?? []), s]);
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-1">
        <Button asChild variant="ghost" size="icon-sm">
          <Link href={hrefFor(prev)} aria-label="Mês anterior">
            <ChevronLeft aria-hidden="true" />
          </Link>
        </Button>
        <Button asChild variant="ghost" size="icon-sm">
          <Link href={hrefFor(next)} aria-label="Próximo mês">
            <ChevronRight aria-hidden="true" />
          </Link>
        </Button>
        <h2 className="ml-1 text-sm font-semibold first-letter:uppercase">{utc(`${month}-15`, { month: "long", year: "numeric" })}</h2>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const outside = d.slice(0, 7) !== month;
          return (
            <li key={d} className={cn("grid min-w-0 content-start gap-1 rounded-lg border p-1.5", outside && "bg-muted/40", d === today && "border-primary", !list.length && "max-lg:hidden")}>
              <p className={cn("text-xs font-semibold first-letter:uppercase", d === today && "text-primary", outside && "text-muted-foreground")}>{utc(d, { weekday: "short", day: "numeric" })}</p>
              {list.map((s) => (
                <Link key={s.id} href={`/conteudo/${s.content_id}`} className={cn("grid gap-0.5 rounded border bg-signal-soft px-1.5 py-1 text-xs text-signal hover:brightness-95", s.status === "erro" && "border-danger bg-danger-soft text-danger")}>
                  <span className="tabular">
                    {hhmm(s.scheduled_at)} {s.account ? PLATFORM_LABEL[s.account.platform as "facebook"] : ""}
                  </span>
                  <span className="font-medium break-words">{s.title}</span>
                  <span>{SCHEDULE_STATUS_LABEL[s.status] ?? s.status}</span>
                </Link>
              ))}
            </li>
          );
        })}
      </ol>
      {schedules.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma publicação neste mês.</p>}
    </div>
  );
}

export function SocialSetup({ accounts, connection, configured, canManage, notice }: { accounts: SocialAccount[]; connection: Connection; configured: boolean; canManage: boolean; notice?: string | null }) {
  const [pending, startTransition] = useTransition();
  const healthy = connection?.status === "ativa";
  const [now] = useState(() => Date.now());
  const expiresSoon = connection?.expires_at ? new Date(connection.expires_at).getTime() - now < 7 * 86_400_000 : false;

  return (
    <div className="grid max-w-3xl gap-4">
      {notice && <p className="rounded-lg border bg-muted/40 p-3 text-sm">{notice}</p>}
      <section aria-labelledby="conta-meta" className="grid gap-3 rounded-xl border bg-surface p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="conta-meta" className="font-semibold">
            Conta Meta para publicar
          </h2>
          {connection && <Badge variant={healthy ? "default" : "destructive"}>{CONNECTION_LABEL[connection.status] ?? connection.status}</Badge>}
        </div>
        <IntegrationGuide id="meta_social" />
        {!configured ? (
          <p className="max-w-prose text-muted-foreground">Esta integração ainda não foi ativada neste sistema. Fale com o suporte pelo passo a passo.</p>
        ) : connection ? (
          <div className="grid gap-1 text-muted-foreground">
            <p>Conectada por {connection.external_user}.</p>
            {connection.expires_at && <p className={expiresSoon ? "text-warning" : undefined}>O acesso vence em {formatDateTime(connection.expires_at)}. Reconectar renova.</p>}
            {connection.last_error && (
              <p className="flex items-start gap-1 text-danger">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {connection.last_error}
              </p>
            )}
          </div>
        ) : (
          <p className="max-w-prose text-muted-foreground">Conecte para escolher as Páginas do Facebook e as contas profissionais do Instagram que recebem as publicações.</p>
        )}
        {configured && canManage && (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant={connection ? "outline" : "default"}>
              {/* Rota de início do OAuth: precisa de navegação completa, não do roteador. */}
              <a href="/api/content/meta/start">
                {connection ? <RefreshCw aria-hidden="true" /> : <Plug aria-hidden="true" />} {connection ? "Reconectar" : "Conectar conta Meta"}
              </a>
            </Button>
            {connection && (
              <ConfirmDialog
                tone="danger"
                trigger={
                  <Button variant="ghost">
                    <Unplug aria-hidden="true" /> Desconectar
                  </Button>
                }
                title="Desconectar a conta Meta?"
                description="O acesso é revogado e os agendamentos pendentes ficam com erro até você reconectar e agendar de novo."
                confirmLabel="Desconectar"
                onConfirm={async () => {
                  const res = await disconnectSocial({});
                  if (res.ok) toast.success(res.message);
                  else toast.error(res.message);
                }}
              />
            )}
          </div>
        )}
      </section>
      {accounts.length > 0 && (
        <section aria-labelledby="contas-destino" className="grid gap-2">
          <h2 id="contas-destino" className="text-sm font-semibold">
            Contas de destino
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">As contas ligadas aparecem no Planejador e podem receber publicações.</p>
          <ul className="grid gap-1">
            {accounts.map((a) => (
              <li key={a.id} className="flex items-center gap-3 rounded-md border bg-surface px-3 py-2 text-sm">
                <Switch
                  checked={a.selected}
                  disabled={!canManage || pending || a.status !== "ativa"}
                  aria-label={`Usar ${a.name} nas publicações`}
                  onCheckedChange={(selected) =>
                    startTransition(async () => {
                      const res = await setSocialSelected({ id: a.id, selected });
                      if (!res.ok) toast.error(res.message);
                    })
                  }
                />
                <AccountAvatar account={a} size="sm" />
                <span className="min-w-0 flex-1 break-words">
                  {a.name}
                  {a.username && <span className="text-muted-foreground"> @{a.username}</span>}
                </span>
                <span className="text-xs text-muted-foreground">{PLATFORM_LABEL[a.platform]}</span>
                {a.status !== "ativa" && <span className="text-xs text-danger">{a.status === "expirada" ? "Acesso expirado" : "Desconectada"}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
