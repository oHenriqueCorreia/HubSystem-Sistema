import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { AlertTriangle, BookOpen, CalendarClock, CalendarDays, CheckCircle2, CircleAlert, Flag, ListTodo, Plus, Sparkles, Timer, Video } from "lucide-react";
import { cn } from "cn";
import { requireUser } from "@/lib/auth/dal";
import { PageBody } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, todayLocal } from "@/domain/shared/dates";
import { formatBRL } from "@/domain/shared/money";
import { getMyDay } from "@/features/tasks/queries";
import { getCrmLookups } from "@/features/crm/queries";
import { MyDay } from "@/features/tasks/components/my-day";
import { TaskFormDialog } from "@/features/tasks/components/task-form-dialog";
import { PRIORITY_LABEL, type TaskPriority } from "@/features/tasks/types";
import { getHomeOverview, HOME_WIDGETS, homePrefs, type HomeOverview, type HomeWidget } from "@/features/home/queries";
import { getWeather } from "@/features/home/weather";
import { dailyMessage, getDailyVerse } from "@/features/home/verse";
import { LiveClock } from "@/features/home/components/live-clock";
import { WeatherCard } from "@/features/home/components/weather-card";
import { HomeCustomizer } from "@/features/home/components/home-customizer";
import type { City } from "@/domain/home";

export const metadata: Metadata = { title: "Início" };

/** Instante da requisição (o relógio do cliente continua a partir dele). */
const requestTime = () => new Date().getTime();
const DAY_MONTH = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

function Panel({ title, icon: Icon, href, children, className }: { title: string; icon?: typeof Flag; href?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("grid content-start gap-3 rounded-xl border bg-surface p-4", className)} aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden="true" />} {title}
        </h2>
        {href && (
          <Link href={href} className="text-xs text-primary hover:underline">
            Ver tudo
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, href, tone }: { label: string; value: string | number; href?: string; tone?: "danger" | "warning" | "success" }) {
  const body = (
    <>
      <span className={cn("tabular text-2xl font-semibold", tone === "danger" && "text-danger", tone === "warning" && "text-warning", tone === "success" && "text-success")}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </>
  );
  const cls = "grid gap-0.5 rounded-lg border bg-background p-3";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-primary")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

async function WeatherSection({ city }: { city: City }) {
  return <WeatherCard weather={await getWeather(city)} cityName={city.name} />;
}

async function VerseSection({ day }: { day: string }) {
  const verse = await getDailyVerse(day);
  return (
    <div className="grid gap-3">
      <figure className="grid gap-1">
        <blockquote className="text-base leading-relaxed text-pretty">{verse.text ? `“${verse.text}”` : "Leia a passagem do dia na sua Bíblia."}</blockquote>
        <figcaption className="text-sm font-medium">
          {verse.reference} <span className="font-normal text-muted-foreground">· {verse.translation}</span>
        </figcaption>
      </figure>
      <p className="flex items-start gap-2 border-t pt-3 text-sm text-muted-foreground">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden="true" /> {dailyMessage(day)}
      </p>
    </div>
  );
}

const fallback = (
  <div className="grid gap-2" aria-busy="true">
    <Skeleton className="h-5 w-32" />
    <Skeleton className="h-16 w-full" />
  </div>
);

const time = (iso: string) => new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(iso));

function TaskList({ items, empty }: { items: HomeOverview["priorityList"]; empty: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="grid gap-1.5">
      {items.map((t) => (
        <li key={t.id} className="flex items-baseline justify-between gap-2 text-sm">
          <Link href={`/tarefas?q=${encodeURIComponent(t.title.slice(0, 60))}`} className="min-w-0 truncate hover:underline">
            {t.title}
          </Link>
          <span className="shrink-0 text-xs text-muted-foreground">
            {t.due_at ? time(t.due_at) : PRIORITY_LABEL[t.priority as TaskPriority]}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function InicioPage() {
  const user = await requireUser();
  const firstName = user.fullName.split(" ")[0];
  const prefs = homePrefs(user);
  const day = todayLocal();
  const today = day;
  const canTasks = Boolean(user.permissions["tasks.read"]);
  const [overview, myDay, lookups] = await Promise.all([
    getHomeOverview(user),
    canTasks && !prefs.hidden.includes("meu_dia") ? getMyDay(user.id) : Promise.resolve(null),
    canTasks ? getCrmLookups() : Promise.resolve(null),
  ]);
  const visible = prefs.order.filter((k) => !prefs.hidden.includes(k));
  const o = overview;
  const serverNow = requestTime();

  const alerts: { text: string; href: string; tone: "danger" | "warning" }[] = [];
  if (o.tasks?.overdue) alerts.push({ text: `${o.tasks.overdue} tarefa(s) atrasada(s)`, href: "/tarefas?periodo=atrasadas", tone: "danger" });
  if (o.commercial?.waiting) alerts.push({ text: `${o.commercial.waiting} lead(s) com contato atrasado`, href: "/crm/leads", tone: "warning" });
  for (const f of o.finance) {
    const dueToday = f.dueSoon.filter((t) => t.due_date === today);
    if (dueToday.length)
      alerts.push({
        text: `${dueToday.length} conta(s) vencem hoje (${f.scope}): ${formatBRL(dueToday.reduce((s, t) => s + t.amount_cents, 0))}`,
        href: `/financeiro/${f.scope}/lancamentos`,
        tone: "warning",
      });
    if (f.overduePayable) alerts.push({ text: `${formatBRL(f.overduePayable)} em contas vencidas (${f.scope})`, href: `/financeiro/${f.scope}/lancamentos`, tone: "danger" });
    if (f.overdueReceivable) alerts.push({ text: `${formatBRL(f.overdueReceivable)} a receber em atraso (${f.scope})`, href: `/financeiro/${f.scope}/lancamentos`, tone: "warning" });
  }
  if (o.google && o.google.status !== "ativa") alerts.push({ text: "Google Agenda desconectado ou com erro", href: "/configuracoes/integracoes", tone: "danger" });
  if (o.pendingInvites) alerts.push({ text: `${o.pendingInvites} convite(s) aguardando aceite`, href: "/configuracoes/usuarios", tone: "warning" });

  const blocks: Record<HomeWidget, ReactNode> = {
    clima: (
      <Panel key="clima" title="Clima">
        <Suspense fallback={fallback}>
          <WeatherSection city={prefs.city} />
        </Suspense>
      </Panel>
    ),
    passagem: (
      <Panel key="passagem" title="Passagem do dia" icon={BookOpen}>
        <Suspense fallback={fallback}>
          <VerseSection day={day} />
        </Suspense>
      </Panel>
    ),
    resumo: o.tasks ? (
      <Panel key="resumo" title="Minhas tarefas" icon={ListTodo} href="/tarefas" className="lg:col-span-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <Stat label="Atrasadas" value={o.tasks.overdue} href="/tarefas?periodo=atrasadas" tone={o.tasks.overdue ? "danger" : undefined} />
          <Stat label="Prioritárias" value={o.tasks.priority} href="/tarefas?prioridade=urgente" tone={o.tasks.priority ? "warning" : undefined} />
          <Stat label="Agendadas" value={o.tasks.scheduled} href="/agenda?tipo=tarefa" />
          <Stat label="A fazer" value={o.tasks.todo} href="/tarefas?modo=quadro" />
          <Stat label="Em andamento" value={o.tasks.doing} href="/tarefas?modo=quadro" />
          <Stat label="Concluídas na semana" value={o.tasks.doneWeek} tone="success" />
        </div>
      </Panel>
    ) : null,
    prioritarias: o.tasks ? (
      <Panel key="prioritarias" title="Prioridade alta e próximas" icon={Flag} href="/tarefas">
        <div className="grid gap-4">
          <div className="grid gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">Alta prioridade</h3>
            <TaskList items={o.priorityList} empty="Nenhuma tarefa urgente ou de alta prioridade." />
          </div>
          <div className="grid gap-2">
            <h3 className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Timer className="size-3" aria-hidden="true" /> Próximas agendadas
            </h3>
            <TaskList items={o.scheduledList} empty="Nada agendado à frente." />
          </div>
        </div>
      </Panel>
    ) : null,
    reunioes: o.meetings ? (
      <Panel key="reunioes" title="Reuniões" icon={CalendarDays} href="/agenda?visao=semana">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Nesta semana" value={o.meetings.week} href="/agenda?visao=semana" />
          <Stat label="Neste mês" value={o.meetings.month} href="/agenda?visao=mes" />
        </div>
        {o.meetings.next.length ? (
          <ul className="grid gap-1.5">
            {o.meetings.next.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{m.title}</span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  {time(m.starts_at)}
                  {m.meet_url && (
                    <a href={m.meet_url} target="_blank" rel="noreferrer" className="text-primary" aria-label={`Entrar na chamada de ${m.title}`}>
                      <Video className="size-4" aria-hidden="true" />
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Sem reuniões até o fim da semana.</p>
        )}
      </Panel>
    ) : null,
    comercial: o.commercial ? (
      <Panel key="comercial" title="Comercial na semana" icon={CalendarClock} href="/crm/leads">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Leads atendidos" value={o.commercial.attendedWeek} />
          <Stat label="Contato atrasado" value={o.commercial.waiting} href="/crm/leads" tone={o.commercial.waiting ? "warning" : undefined} />
          <Stat label="Leads novos" value={o.commercial.newLeadsWeek} href="/crm/leads" />
        </div>
      </Panel>
    ) : null,
    financeiro: o.finance.length ? (
      <Panel key="financeiro" title="Financeiro do mês" icon={CheckCircle2} className="lg:col-span-2">
        <div className="grid gap-4 md:grid-cols-2">
          {o.finance.map((f) => (
            <div key={f.scope} className="grid gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">{f.scope === "empresa" ? "Empresa" : "Pessoal"}</h3>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="A receber até o fim do mês" value={formatBRL(f.receivable)} href={`/financeiro/${f.scope}/lancamentos`} tone="success" />
                <Stat label="A pagar até o fim do mês" value={formatBRL(f.payable)} href={`/financeiro/${f.scope}/lancamentos`} tone={f.payable ? "warning" : undefined} />
                <Stat label="Recebido no mês" value={formatBRL(f.monthIn)} />
                <Stat label="Pago no mês" value={formatBRL(f.monthOut)} />
              </div>
              <p className="text-xs text-muted-foreground">Saldo realizado no mês: {formatBRL(f.monthIn - f.monthOut)}</p>
              <div className="grid gap-1.5 border-t pt-2">
                <h4 className="text-xs font-medium">A pagar nos próximos 7 dias</h4>
                {f.dueSoon.length ? (
                  <ul className="grid gap-1 text-sm">
                    {f.dueSoon.map((t) => (
                      <li key={t.id} className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate">
                          <span className={cn("tabular mr-2 text-xs", t.due_date === today ? "font-semibold text-danger" : "text-muted-foreground")}>
                            {t.due_date === today ? "Hoje" : DAY_MONTH.format(new Date(`${t.due_date}T12:00:00Z`))}
                          </span>
                          {t.description}
                          {t.recurrence_id && <span className="sr-only"> (conta fixa)</span>}
                        </span>
                        <span className="tabular shrink-0">{formatBRL(t.amount_cents)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">Nada vence nos próximos 7 dias.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    ) : null,
    alertas: (
      <Panel key="alertas" title="Alertas e integrações" icon={AlertTriangle}>
        {alerts.length ? (
          <ul className="grid gap-1.5">
            {alerts.map((a) => (
              <li key={a.text}>
                <Link href={a.href} className={cn("flex items-center gap-2 text-sm hover:underline", a.tone === "danger" ? "text-danger" : "text-warning")}>
                  <CircleAlert className="size-4 shrink-0" aria-hidden="true" /> {a.text}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="size-4" aria-hidden="true" /> Tudo em dia.
          </p>
        )}
        <dl className="grid gap-1 border-t pt-3 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Google Agenda</dt>
            <dd>
              {o.google ? (
                <Link href="/configuracoes/integracoes" className={o.google.status === "ativa" ? "text-success" : "text-danger"}>
                  {o.google.status === "ativa" ? `Conectado${o.google.last_synced_at ? ` · ${formatDateTime(o.google.last_synced_at)}` : ""}` : "Requer atenção"}
                </Link>
              ) : (
                <Link href="/configuracoes/integracoes" className="text-primary hover:underline">
                  Conectar
                </Link>
              )}
            </dd>
          </div>
        </dl>
      </Panel>
    ),
    meu_dia:
      myDay && lookups ? (
        <section key="meu_dia" aria-label="Meu dia" className="lg:col-span-2">
          <MyDay {...myDay} owners={lookups.owners} canDelete={Boolean(user.permissions["tasks.delete"])} />
        </section>
      ) : null,
  };

  return (
    <PageBody className="grid gap-6 pt-6">
      <LiveClock firstName={firstName} serverNow={serverNow} />
      <div className="flex flex-wrap gap-2">
        {user.permissions["tasks.create"] && lookups && (
          <TaskFormDialog
            owners={lookups.owners}
            canAssign={user.permissions["tasks.create"] !== "own"}
            defaults={{ dueDate: day }}
            trigger={
              <Button>
                <Plus aria-hidden="true" /> Nova tarefa
              </Button>
            }
          />
        )}
        <HomeCustomizer widgets={HOME_WIDGETS} order={prefs.order} hidden={prefs.hidden} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">{visible.map((k) => blocks[k])}</div>
    </PageBody>
  );
}
