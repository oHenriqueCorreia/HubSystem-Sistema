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
import { ContentCalendar, ContentList, NewContentDialog, SocialSetup } from "@/features/content/components/content-home";
import { getSocialSetup, listContent, listSchedules } from "@/features/content/queries";

export const metadata: Metadata = { title: "Conteúdo" };

const TABS = [
  ["producao", "Produção"],
  ["calendario", "Calendário"],
  ["contas", "Contas"],
] as const;

const ERRORS: Record<string, string> = {
  indisponivel: "A integração não está disponível para você ou ainda não foi configurada.",
  cancelado: "A conexão foi cancelada.",
  estado: "A solicitação expirou. Tente conectar novamente.",
  falha: "Não foi possível concluir a conexão. Confira as permissões concedidas e tente novamente.",
};

const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function ConteudoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePermission("content.read");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === str(sp.aba)) ? str(sp.aba)! : "producao";
  const status = str(sp.situacao);
  const today = todayLocal();
  const month = /^\d{4}-\d{2}$/.test(str(sp.mes) ?? "") ? str(sp.mes)! : today.slice(0, 7);
  const canManage = Boolean(user.permissions["content.manage"] && user.permissions["tasks.create"]);
  const canPublish = Boolean(user.permissions["content.publish"]);
  const range = monthRange(`${month}-15`);

  const [items, schedules, social, lookups, campaigns] = await Promise.all([
    tab === "producao" ? listContent({ status }) : Promise.resolve([]),
    tab === "calendario" ? listSchedules(zonedIso(range.from, "00:00"), zonedIso(addDays(range.to, 1), "00:00")) : Promise.resolve([]),
    tab === "contas" ? getSocialSetup() : Promise.resolve({ accounts: [], connection: null }),
    canManage ? getCrmLookups() : Promise.resolve(null),
    canManage && user.permissions["ads.read"] ? (await createClient()).from("ad_campaigns").select("id, name").order("name").limit(300) : Promise.resolve({ data: [] }),
  ]);
  const notice = str(sp.erro) ? (ERRORS[str(sp.erro)!] ?? ERRORS.falha) : str(sp.conectado) ? `Conta conectada. ${str(sp.contas) ?? 0} conta(s) encontrada(s): escolha abaixo quais recebem publicações.` : null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Trabalho" }, { label: "Conteúdo" }]}
        title="Conteúdo"
        description="Produção, aprovação do cliente e publicação no Facebook e Instagram."
        actions={canManage && lookups ? <NewContentDialog owners={lookups.owners} campaigns={(campaigns.data ?? []) as { id: string; name: string }[]} canAssign={user.permissions["tasks.create"] !== "own"} /> : null}
      />
      <PageBody className="grid gap-4">
        <nav aria-label="Seções do conteúdo" className="flex gap-1 border-b">
          {TABS.map(([k, label]) => (
            <Link
              key={k}
              href={k === "producao" ? "/conteudo" : `/conteudo?aba=${k}`}
              aria-current={tab === k ? "page" : undefined}
              className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap", tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {label}
            </Link>
          ))}
        </nav>
        {tab === "producao" && <ContentListRoute items={items} status={status} />}
        {tab === "calendario" && <CalendarRoute month={month} schedules={schedules} today={today} />}
        {tab === "contas" && <SocialSetup accounts={social.accounts} connection={social.connection} configured={socialConfigured()} canManage={canPublish} notice={notice} />}
      </PageBody>
    </>
  );
}

function ContentListRoute({ items, status }: { items: Awaited<ReturnType<typeof listContent>>; status?: string }) {
  return <ContentList items={items} statusFilter={status} hrefs={{ all: "/conteudo", status: "/conteudo?situacao=" }} />;
}

function CalendarRoute({ month, schedules, today }: { month: string; schedules: Awaited<ReturnType<typeof listSchedules>>; today: string }) {
  return <ContentCalendar month={month} schedules={schedules} today={today} hrefBase="/conteudo?aba=calendario&mes=" />;
}
