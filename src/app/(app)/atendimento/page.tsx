import type { Metadata } from "next";
import Link from "next/link";
import { ScrollMemory } from "@/components/app/scroll-memory";
import { Check, CheckCheck, History, MessagesSquare, Search, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { requirePermission } from "@/lib/auth/dal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatPhone } from "@/domain/shared/phone";
import { todayLocal } from "@/domain/shared/dates";
import { chatTitle, listTime, messagePreview } from "@/domain/whatsapp/chat";
import { whatsappConfigured } from "@/lib/whatsapp";
import { getCrmLookups } from "@/features/crm/queries";
import { TagChip } from "@/features/crm/components/chips";
import type { TagColor } from "@/features/crm/types";
import { getLeadWork, listCadences } from "@/features/tasks/queries";
import { LeadWorkPanel } from "@/features/tasks/components/lead-work-panel";
import { getConversation, getInboxSetup, listClientOptions, listConversations, listLeadDeals, listQuickReplies, type InboxFilters } from "@/features/inbox/queries";
import { ChatAvatar, ChatView } from "@/features/inbox/components/chat-view";
import { NumbersDialog } from "@/features/inbox/components/numbers-dialog";
import { WhatsAppSetup } from "@/features/inbox/components/whatsapp-setup";
import { InboxRealtime } from "@/features/inbox/components/inbox-realtime";
import { InboxNav } from "@/features/inbox/components/inbox-nav";
import { LeadSidePanel } from "@/features/inbox/components/lead-side-panel";

export const metadata: Metadata = { title: "Atendimento" };

// A compilação de conversas roda em etapas de até 25 segundos nas ações desta tela.
export const maxDuration = 60;

const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
const TABS: [NonNullable<InboxFilters["status"]>, string][] = [
  ["abertas", "Abertas"],
  ["aguardando", "Aguardando resposta"],
  ["grupos", "Grupos"],
  ["encerradas", "Encerradas"],
  ["todas", "Todas"],
];

export default async function AtendimentoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePermission("inbox.read");
  const sp = await searchParams;
  const filters: InboxFilters = {
    q: str(sp.q)?.slice(0, 80),
    status: (str(sp.situacao) as InboxFilters["status"]) ?? "abertas",
    responsavel: str(sp.responsavel),
    etiqueta: str(sp.etiqueta),
    numero: /^[0-9a-f-]{36}$/i.test(str(sp.numero) ?? "") ? str(sp.numero) : undefined,
    de: str(sp.de),
    ate: str(sp.ate),
  };
  const page = Math.max(0, Number(str(sp.pagina) ?? 0) || 0);
  const selectedId = str(sp.conversa);
  const [list, setup, lookups, selected, quickReplies] = await Promise.all([
    listConversations(filters, user.id, page),
    getInboxSetup(),
    getCrmLookups(),
    selectedId && /^[0-9a-f-]{36}$/i.test(selectedId) ? getConversation(selectedId) : Promise.resolve(null),
    listQuickReplies(),
  ]);
  const selectedLead = selected?.lead ?? null;
  const clients = selected ? await listClientOptions() : [];
  const [leadDeals, leadWork, cadences] = selectedLead ? await Promise.all([listLeadDeals(selectedLead.id), getLeadWork(selectedLead.id), listCadences()]) : [[], null, []];
  const channel = selected ? setup.numbers.find((n) => n.id === selected.number_id) : undefined;
  const names = Object.fromEntries(lookups.owners.map((o) => [o.id, o.full_name || o.email]));
  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string")), ...patch })) if (v) q.set(k, v as string);
    return `/atendimento?${q.toString()}`;
  };
  const active = setup.numbers.some((n) => n.status === "ativo");
  const today = todayLocal();
  const canManage = Boolean(user.permissions["inbox.manage"]);
  const hasProblem = setup.numbers.some((n) => n.status !== "ativo" && n.status !== "desconectado");
  const numberLabel = (id: string) => {
    const n = setup.numbers.find((x) => x.id === id);
    return n ? n.verified_name || n.display_phone : "";
  };
  const setupPanel = <WhatsAppSetup numbers={setup.numbers} configured={whatsappConfigured()} qrConfigured={Boolean(process.env.WAHA_URL && process.env.WAHA_API_KEY)} canManage={canManage} templateCount={setup.templates.length} />;

  return (
    <>
      <InboxRealtime />
      <h1 className="sr-only">Atendimento</h1>
      {selected && <span data-chat-open className="hidden" />}
      <div className={cn("px-3 pt-1", selected && "max-md:hidden")}>
        <InboxNav />
      </div>
      <div
        className={cn(
          "grid grid-cols-[minmax(0,1fr)] overflow-hidden border-t bg-surface md:m-3 md:h-[calc(100dvh-7rem)] md:grid-cols-[23rem_minmax(0,1fr)] md:rounded-xl md:border",
          selected ? "h-dvh" : "h-[calc(100dvh-6.125rem-4.5rem-env(safe-area-inset-bottom))]",
        )}
      >
        <aside aria-label="Conversas" className={cn("flex min-h-0 flex-col border-r", selected && "hidden md:flex")}>
          <div className="grid gap-2 bg-[var(--chat-panel)] px-3 py-2">
            <div className="flex items-center gap-2">
              <h2 className="flex-1 text-base font-semibold">Conversas</h2>
              <span className="text-xs text-muted-foreground tabular">{list.total}</span>
              {(canManage || !active) && (
                <NumbersDialog alert={hasProblem || !active} defaultOpen={!active && setup.numbers.length === 0}>
                  {setupPanel}
                </NumbersDialog>
              )}
            </div>
            <form action="/atendimento" className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input name="q" type="search" defaultValue={filters.q} placeholder="Pesquisar nome ou número…" aria-label="Pesquisar conversas" className="border-0 bg-[var(--chat-input)] pl-9" />
              {filters.status !== "abertas" && <input type="hidden" name="situacao" value={filters.status} />}
              {filters.numero && <input type="hidden" name="numero" value={filters.numero} />}
            </form>
          </div>
          <nav aria-label="Filtrar conversas" className="flex items-center gap-1.5 overflow-x-auto border-b px-3 py-1 md:py-2">
            {TABS.map(([k, label]) => (
              <Link
                key={k}
                href={href({ situacao: k === "abertas" ? undefined : k, pagina: undefined, conversa: undefined })}
                aria-current={filters.status === k ? "page" : undefined}
                className={cn("rounded-full px-3 py-1 text-sm font-medium whitespace-nowrap md:text-xs transition-colors", filters.status === k ? "bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-white" : "bg-muted text-muted-foreground hover:bg-accent")}
              >
                {label}
              </Link>
            ))}
            <Link
              href={href({ responsavel: filters.responsavel === "eu" ? undefined : "eu", conversa: undefined })}
              aria-current={filters.responsavel === "eu" ? "page" : undefined}
              className={cn("rounded-full px-3 py-1 text-sm font-medium whitespace-nowrap md:text-xs transition-colors", filters.responsavel === "eu" ? "bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-white" : "bg-muted text-muted-foreground hover:bg-accent")}
            >
              Minhas
            </Link>
          </nav>
          {setup.numbers.length > 1 && (
            <nav aria-label="Filtrar por número" className="flex gap-1.5 overflow-x-auto border-b px-3 py-1.5">
              <Link href={href({ numero: undefined, conversa: undefined })} aria-current={!filters.numero ? "page" : undefined} className={cn("rounded-md px-2 py-0.5 text-xs whitespace-nowrap", !filters.numero ? "font-semibold" : "text-muted-foreground hover:underline")}>
                Todos os números
              </Link>
              {setup.numbers.map((n) => (
                <Link key={n.id} href={href({ numero: n.id, conversa: undefined })} aria-current={filters.numero === n.id ? "page" : undefined} className={cn("rounded-md px-2 py-0.5 text-xs whitespace-nowrap", filters.numero === n.id ? "font-semibold" : "text-muted-foreground hover:underline")}>
                  {n.verified_name || n.display_phone || "Número"}
                </Link>
              ))}
            </nav>
          )}
          {setup.activeImports.length > 0 && (
            <p className="flex items-center gap-2 border-b bg-info-soft px-3 py-2 text-xs" role="status">
              <History className="size-4 shrink-0" aria-hidden="true" />
              <span>Compilando conversas: {setup.activeImports.reduce((a, j) => a + j.contacts_done + j.groups_done, 0).toLocaleString("pt-BR")} até agora.</span>
            </p>
          )}
          {list.items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{!active ? "Conecte um número para começar a receber mensagens." : filters.status === "grupos" ? "Nenhum grupo por aqui. Compile as conversas em Números conectados para trazer os grupos." : "Nenhuma conversa com estes filtros."}</p>
          ) : (
            <ScrollMemory id={`atendimento-${filters.status}`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {list.items.map((c) => {
                const mine = c.preview?.direction === "saida";
                const name = chatTitle(c, formatPhone);
                const group = c.kind === "grupo";
                const senderPrefix = group && !mine && c.preview?.sender_name ? `${c.preview.sender_name.split(" ")[0]}: ` : "";
                const unread = c.unread_count > 0;
                return (
                  <li key={c.id}>
                    <Link href={href({ conversa: c.id })} aria-current={selected?.id === c.id ? "true" : undefined} className={cn("flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent", selected?.id === c.id && "bg-accent")}>
                      <ChatAvatar name={c.contact_name} seed={c.contact_e164 ?? c.group_jid ?? c.id} group={group} className="size-12 text-base" />
                      <span className="grid min-w-0 flex-1 gap-0.5 border-b pb-2.5">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate font-medium">{name}</span>
                          <span className={cn("shrink-0 text-xs tabular", unread ? "font-semibold text-[#00a884]" : "text-muted-foreground")}>{c.last_message_at ? listTime(c.last_message_at, today) : ""}</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          {mine && (c.preview?.status === "lida" ? <CheckCheck className="size-4 shrink-0 text-[#53bdeb]" aria-label="Lida" /> : c.preview?.status === "entregue" ? <CheckCheck className="size-4 shrink-0 text-muted-foreground" aria-label="Entregue" /> : c.preview?.status === "erro" ? <TriangleAlert className="size-3.5 shrink-0 text-danger" aria-label="Erro no envio" /> : <Check className="size-4 shrink-0 text-muted-foreground" aria-label="Enviada" />)}
                          <span className={cn("min-w-0 flex-1 truncate text-sm", unread ? "font-medium text-foreground" : "text-muted-foreground")}>{c.preview ? `${senderPrefix}${messagePreview(c.preview)}` : c.lead ? c.lead.name : "Sem mensagens"}</span>
                          {unread && <span className="grid min-w-5 shrink-0 place-items-center rounded-full bg-[#00a884] px-1.5 text-[11px] font-semibold text-white tabular">{c.unread_count}</span>}
                        </span>
                        {(c.tags.length > 0 || (setup.numbers.length > 1 && numberLabel(c.number_id)) || (c.assignee_id && names[c.assignee_id])) && (
                          <span className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                            {c.status === "encerrada" && <span className="rounded bg-muted px-1">Encerrada</span>}
                            {setup.numbers.length > 1 && <span className="max-w-28 truncate rounded bg-muted px-1">{numberLabel(c.number_id)}</span>}
                            {c.assignee_id && names[c.assignee_id] && <span className="max-w-28 truncate">{names[c.assignee_id]}</span>}
                            {c.tags.slice(0, 2).map((t) => (
                              <TagChip key={t.id} name={t.name} color={t.color as TagColor} />
                            ))}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ScrollMemory>
          )}
          {(page > 0 || list.hasMore) && (
            <div className="flex justify-between border-t p-2">
              {page > 0 ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href={href({ pagina: page > 1 ? String(page - 1) : undefined })}>Mais recentes</Link>
                </Button>
              ) : (
                <span />
              )}
              {list.hasMore && (
                <Button asChild variant="ghost" size="sm">
                  <Link href={href({ pagina: String(page + 1) })}>Mais antigas</Link>
                </Button>
              )}
            </div>
          )}
        </aside>
        <div className={cn("min-h-0 min-w-0", !selected && "hidden md:block")}>
          {selected ? (
            <ChatView
              key={selected.id}
              conversation={selected}
              owners={lookups.owners}
              templates={setup.templates}
              tags={lookups.tags}
              pipelines={lookups.pipelines.map((p) => ({ id: p.id, name: p.name }))}
              clients={clients}
              names={names}
              canReply={Boolean(user.permissions["inbox.reply"])}
              canManage={canManage}
              canCreateLead={Boolean(user.permissions["crm.leads.create"])}
              provider={channel?.provider ?? "cloud"}
              online={channel?.status === "ativo"}
              quickReplies={quickReplies}
              leadPanel={
                selectedLead && leadWork ? (
                  <LeadSidePanel
                    lead={{ id: selectedLead.id, name: selectedLead.name }}
                    nextContactAt={selectedLead.next_contact_at}
                    canMove={Boolean(user.permissions["crm.pipeline.move"])}
                    canUpdate={Boolean(user.permissions["crm.leads.update"])}
                    deals={leadDeals.map((d) => {
                      const pipeline = lookups.pipelines.find((p) => p.id === d.pipeline_id);
                      return { id: d.id, stage_id: d.stage_id, pipeline_name: pipeline?.name ?? "Funil", stages: (pipeline?.stages ?? []).map((s) => ({ id: s.id, name: s.name, kind: s.kind })) };
                    })}
                  >
                    <LeadWorkPanel
                      lead={{ id: selectedLead.id, name: selectedLead.name }}
                      tasks={leadWork.tasks}
                      events={leadWork.events}
                      enrollments={leadWork.enrollments}
                      cadences={cadences}
                      owners={lookups.owners}
                      meId={user.id}
                      perms={{
                        createTask: Boolean(user.permissions["tasks.create"]),
                        assignTask: Boolean(user.permissions["tasks.create"] && user.permissions["tasks.create"] !== "own"),
                        deleteTask: Boolean(user.permissions["tasks.delete"]),
                        manageCalendar: Boolean(user.permissions["calendar.manage"]),
                        assignCalendar: Boolean(user.permissions["calendar.manage"] && user.permissions["calendar.manage"] !== "own"),
                      }}
                    />
                  </LeadSidePanel>
                ) : undefined
              }
            />
          ) : (
            <div className="chat-wallpaper grid h-full place-items-center p-6">
              <div className="grid justify-items-center gap-2 rounded-2xl bg-[var(--chat-pill)]/90 px-8 py-6 text-center shadow-xs">
                <MessagesSquare className="size-10 text-[#00a884]" aria-hidden="true" />
                <p className="font-semibold">Escolha uma conversa</p>
                <p className="max-w-xs text-sm text-muted-foreground">As mensagens chegam aqui na hora, e as observações internas ficam só para a equipe.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
