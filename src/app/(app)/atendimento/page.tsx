import type { Metadata } from "next";
import Link from "next/link";
import { MessagesSquare, Search } from "lucide-react";
import { cn } from "cn";
import { requirePermission } from "@/lib/auth/dal";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatPhone } from "@/domain/shared/phone";
import { formatRelative } from "@/domain/shared/dates";
import { whatsappConfigured } from "@/lib/whatsapp";
import { getCrmLookups } from "@/features/crm/queries";
import { TagChip } from "@/features/crm/components/chips";
import type { TagColor } from "@/features/crm/types";
import { getConversation, getInboxSetup, listConversations, type InboxFilters } from "@/features/inbox/queries";
import { ConversationView } from "@/features/inbox/components/conversation-view";
import { WhatsAppSetup } from "@/features/inbox/components/whatsapp-setup";

export const metadata: Metadata = { title: "Atendimento" };

const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
const TABS: [NonNullable<InboxFilters["status"]>, string][] = [
  ["abertas", "Abertas"],
  ["aguardando", "Aguardando resposta"],
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
    de: str(sp.de),
    ate: str(sp.ate),
  };
  const page = Math.max(0, Number(str(sp.pagina) ?? 0) || 0);
  const selectedId = str(sp.conversa);
  const [list, setup, lookups, selected] = await Promise.all([
    listConversations(filters, user.id, page),
    getInboxSetup(),
    getCrmLookups(),
    selectedId && /^[0-9a-f-]{36}$/i.test(selectedId) ? getConversation(selectedId) : Promise.resolve(null),
  ]);
  const names = Object.fromEntries(lookups.owners.map((o) => [o.id, o.full_name || o.email]));
  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string")), ...patch })) if (v) q.set(k, v as string);
    return `/atendimento?${q.toString()}`;
  };
  const active = setup.numbers.some((n) => n.status === "ativo");

  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Comercial" }, { label: "Atendimento" }]} title="Atendimento" description="Conversas do WhatsApp ligadas aos leads e ao funil." />
      <div className="grid gap-4 px-4 pb-6 sm:px-6">
        {(!active || user.permissions["inbox.manage"]) && (
          <details className="rounded-xl border bg-surface p-3" open={!active}>
            <summary className="cursor-pointer text-sm font-semibold">Números conectados</summary>
            <div className="mt-3">
              <WhatsAppSetup numbers={setup.numbers} configured={whatsappConfigured()} canManage={Boolean(user.permissions["inbox.manage"])} templateCount={setup.templates.length} />
            </div>
          </details>
        )}

        <div className="grid h-[calc(100dvh-14rem)] min-h-[28rem] overflow-hidden rounded-xl border bg-surface md:grid-cols-[22rem_minmax(0,1fr)]">
          <aside aria-label="Conversas" className={cn("flex min-h-0 flex-col border-r", selected && "hidden md:flex")}>
            <form action="/atendimento" className="relative border-b p-2">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input name="q" defaultValue={filters.q} placeholder="Buscar nome ou número…" aria-label="Buscar conversas" className="pl-8" />
              {filters.status !== "abertas" && <input type="hidden" name="situacao" value={filters.status} />}
            </form>
            <nav aria-label="Situação" className="flex gap-1 overflow-x-auto border-b px-2 py-1.5">
              {TABS.map(([k, label]) => (
                <Link
                  key={k}
                  href={href({ situacao: k === "abertas" ? undefined : k, pagina: undefined, conversa: undefined })}
                  aria-current={filters.status === k ? "page" : undefined}
                  className={cn("rounded-md px-2 py-1 text-xs whitespace-nowrap", filters.status === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
                >
                  {label}
                </Link>
              ))}
              <Link
                href={href({ responsavel: filters.responsavel === "eu" ? undefined : "eu", conversa: undefined })}
                aria-current={filters.responsavel === "eu" ? "page" : undefined}
                className={cn("rounded-md px-2 py-1 text-xs whitespace-nowrap", filters.responsavel === "eu" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
              >
                Minhas
              </Link>
            </nav>
            {list.items.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">{active ? "Nenhuma conversa com estes filtros." : "Conecte um número para começar a receber mensagens."}</p>
            ) : (
              <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {list.items.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={href({ conversa: c.id })}
                      aria-current={selected?.id === c.id ? "true" : undefined}
                      className={cn("grid gap-0.5 border-b px-3 py-2.5 text-sm hover:bg-accent", selected?.id === c.id && "bg-accent")}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className={cn("truncate", c.unread_count > 0 && "font-semibold")}>{c.contact_name || formatPhone(c.contact_e164)}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{c.last_message_at ? formatRelative(c.last_message_at) : ""}</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {c.waiting_reply && c.status === "aberta" && <span className="rounded bg-warning-soft px-1 text-warning">Aguardando</span>}
                        {c.unread_count > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground tabular">{c.unread_count}</span>}
                        <span className="truncate">{c.lead ? c.lead.name : "Sem lead"}</span>
                        {c.assignee_id && <span className="truncate">· {names[c.assignee_id] ?? ""}</span>}
                      </span>
                      {c.tags.length > 0 && (
                        <span className="flex flex-wrap gap-1">
                          {c.tags.slice(0, 3).map((t) => (
                            <TagChip key={t.id} name={t.name} color={t.color as TagColor} />
                          ))}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {(page > 0 || list.hasMore) && (
              <div className="flex justify-between border-t p-2">
                <Button asChild variant="ghost" size="sm" disabled={page === 0}>
                  <Link href={href({ pagina: page > 1 ? String(page - 1) : undefined })} aria-disabled={page === 0}>
                    Anteriores
                  </Link>
                </Button>
                {list.hasMore && (
                  <Button asChild variant="ghost" size="sm">
                    <Link href={href({ pagina: String(page + 1) })}>Mais antigas</Link>
                  </Button>
                )}
              </div>
            )}
          </aside>
          <div className={cn("min-h-0", !selected && "hidden md:block")}>
            {selected ? (
              <ConversationView
                key={selected.id}
                conversation={selected}
                owners={lookups.owners}
                templates={setup.templates}
                tags={lookups.tags}
                pipelines={lookups.pipelines.map((p) => ({ id: p.id, name: p.name }))}
                names={names}
                canReply={Boolean(user.permissions["inbox.reply"])}
                canManage={Boolean(user.permissions["inbox.manage"])}
                canCreateLead={Boolean(user.permissions["crm.leads.create"])}
              />
            ) : (
              <div className="grid h-full place-items-center p-6">
                <EmptyState icon={MessagesSquare} title="Escolha uma conversa" description="As mensagens aparecem aqui, com as observações internas da equipe destacadas." />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
