import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "cn";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { zonedIso } from "@/domain/calendar";
import { addDays, monthRange } from "@/domain/calendar/agenda";
import { todayLocal } from "@/domain/shared/dates";
import { getCrmLookups } from "@/features/crm/queries";
import { socialConfigured } from "@/lib/meta-social";
import { createClient } from "@/lib/supabase/server";
import { ContentList, NewContentDialog, SocialSetup } from "@/features/content/components/content-home";
import { AccountRail, CreateButtons, Planner, RecentPublished, StudioHeader } from "@/features/content/components/studio";
import { getSocialSetup, listContent, listSchedules } from "@/features/content/queries";

export const metadata: Metadata = { title: "Conteúdo" };

const TABS = [
  ["planejador", "Planejador"],
  ["producao", "Produção"],
  ["contas", "Contas"],
] as const;

const ERRORS: Record<string, string> = {
  indisponivel: "A integração não está disponível para você ou ainda não foi configurada.",
  cancelado: "A conexão foi cancelada.",
  estado: "A solicitação expirou. Tente conectar novamente.",
  falha: "Não foi possível concluir a conexão. Confira as permissões concedidas e tente novamente.",
};

const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
const STALE_MS = 3 * 86_400_000;

export default async function ConteudoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePermission("content.read");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === str(sp.aba)) ? str(sp.aba)! : "planejador";
  const status = str(sp.situacao);
  const today = todayLocal();
  const month = /^\d{4}-\d{2}$/.test(str(sp.mes) ?? "") ? str(sp.mes)! : today.slice(0, 7);
  const canCreate = Boolean(user.permissions["content.manage"] && user.permissions["tasks.create"]);
  const canPublish = Boolean(user.permissions["content.publish"]);
  const range = monthRange(`${month}-15`);
  const supabase = await createClient();

  const [items, allSchedules, social, lookups, campaigns, waiting] = await Promise.all([
    tab === "producao" ? listContent({ status }) : Promise.resolve([]),
    tab === "planejador" ? listSchedules(zonedIso(range.from, "00:00"), zonedIso(addDays(range.to, 1), "00:00")) : Promise.resolve([]),
    getSocialSetup(),
    tab === "producao" && canCreate ? getCrmLookups() : Promise.resolve(null),
    tab === "producao" && canCreate && user.permissions["ads.read"] ? supabase.from("ad_campaigns").select("id, name").order("name").limit(300) : Promise.resolve({ data: [] }),
    tab === "planejador" ? supabase.from("content_items").select("id", { count: "exact", head: true }).eq("status", "aguardando_aprovacao") : Promise.resolve({ count: 0 }),
  ]);
  const notice = str(sp.erro) ? (ERRORS[str(sp.erro)!] ?? ERRORS.falha) : str(sp.conectado) ? `Conta conectada. ${str(sp.contas) ?? 0} conta(s) encontrada(s): ative abaixo as que você quer usar.` : null;
  const current = social.accounts.find((a) => a.id === str(sp.conta) && a.selected) ?? null;
  const schedules = current ? allSchedules.filter((s) => s.account_id === current.id) : allSchedules;
  // Fotos da Meta expiram: atualiza em segundo plano quando estão velhas.
  // eslint-disable-next-line react-hooks/purity -- página de servidor, calculada uma vez por acesso
  const needsRefresh = social.accounts.some((a) => a.status === "ativa" && (!a.picture_checked_at || Date.now() - new Date(a.picture_checked_at).getTime() > STALE_MS));
  const count = (st: string) => schedules.filter((s) => s.status === st).length;
  const hrefBase = `/conteudo?${current ? `conta=${current.id}&` : ""}`;

  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Trabalho" }, { label: "Conteúdo" }]} title="Estúdio de conteúdo" description="Programe posts, vídeos e reels nas suas contas do Facebook e do Instagram." />
      <PageBody className="grid gap-4">
        <nav aria-label="Seções do conteúdo" className="flex gap-1 border-b">
          {TABS.map(([k, label]) => (
            <Link
              key={k}
              href={k === "planejador" ? "/conteudo" : `/conteudo?aba=${k}`}
              aria-current={tab === k ? "page" : undefined}
              className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap", tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {label}
            </Link>
          ))}
        </nav>
        {tab === "planejador" && (
          <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <AccountRail accounts={social.accounts} current={current?.id ?? null} baseHref="/conteudo" needsRefresh={needsRefresh} />
            <div className="grid min-w-0 content-start gap-4">
              <StudioHeader account={current} stats={{ agendados: count("agendado") + count("publicando"), publicados: count("publicado"), erros: count("erro"), aguardando: waiting.count ?? 0 }}>
                {canCreate && canPublish && <CreateButtons accounts={social.accounts} account={current?.id ?? null} />}
              </StudioHeader>
              <Planner month={month} schedules={schedules} today={today} hrefBase={hrefBase} />
              <RecentPublished schedules={schedules} />
            </div>
          </div>
        )}
        {tab === "producao" && (
          <div className="grid gap-3">
            {canCreate && lookups && (
              <div>
                <NewContentDialog owners={lookups.owners} campaigns={((campaigns as { data: unknown }).data ?? []) as { id: string; name: string }[]} canAssign={user.permissions["tasks.create"] !== "own"} />
              </div>
            )}
            <ContentList items={items} statusFilter={status} hrefs={{ all: "/conteudo?aba=producao", status: "/conteudo?aba=producao&situacao=" }} />
          </div>
        )}
        {tab === "contas" && <SocialSetup accounts={social.accounts} connection={social.connection} configured={socialConfigured()} canManage={canPublish} notice={notice} />}
      </PageBody>
    </>
  );
}
