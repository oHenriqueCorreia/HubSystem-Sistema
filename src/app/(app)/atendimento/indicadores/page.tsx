import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/dal";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BarChart3 } from "lucide-react";
import { todayLocal } from "@/domain/shared/dates";
import { InboxNav } from "@/features/inbox/components/inbox-nav";
import { getInboxReport } from "@/features/inbox/ops-queries";

export const metadata: Metadata = { title: "Indicadores do atendimento" };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function duration(seconds: number | null) {
  if (seconds === null) return "Sem dados";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

export default async function IndicadoresPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("inbox.read");
  const sp = await searchParams;
  const today = todayLocal();
  const monthStart = `${today.slice(0, 8)}01`;
  const from = typeof sp.de === "string" && DAY.test(sp.de) ? sp.de : monthStart;
  const to = typeof sp.ate === "string" && DAY.test(sp.ate) ? sp.ate : today;
  const report = await getInboxReport(from, to);
  const stats = [
    { label: "Conversas iniciadas", value: String(report.total) },
    { label: "Primeira resposta, em média", value: duration(report.avg_first_response_seconds) },
    { label: "Esperando resposta agora", value: String(report.waiting) },
    { label: "Encerradas", value: String(report.closed) },
  ];

  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Comercial" }, { label: "Atendimento", href: "/atendimento" }, { label: "Indicadores" }]} title="Indicadores do atendimento" description="Conta as conversas iniciadas no período escolhido." />
      <div className="grid gap-4 px-4 pb-6 sm:px-6">
        <InboxNav />
        <form action="/atendimento/indicadores" className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm">
            De
            <Input type="date" name="de" defaultValue={from} className="w-40" />
          </label>
          <label className="grid gap-1 text-sm">
            Até
            <Input type="date" name="ate" defaultValue={to} className="w-40" />
          </label>
          <Button type="submit" variant="outline">
            Aplicar
          </Button>
        </form>

        {report.total === 0 ? (
          <EmptyState icon={BarChart3} title="Nenhuma conversa neste período" description="Os números aparecem quando as conversas começarem a chegar." />
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label} className="rounded-xl border bg-surface p-4">
                  <dt className="text-sm text-muted-foreground">{s.label}</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular">{s.value}</dd>
                </div>
              ))}
            </dl>

            <section aria-labelledby="por-atendente" className="grid gap-2">
              <h2 id="por-atendente" className="text-sm font-semibold">
                Por atendente
              </h2>
              <div className="overflow-x-auto rounded-xl border bg-surface">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Atendente
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Conversas
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Encerradas
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Primeira resposta
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.by_assignee.map((a) => (
                      <tr key={a.assignee_id ?? "sem"} className="border-b last:border-0">
                        <td className="px-3 py-2">{a.name}</td>
                        <td className="px-3 py-2 text-right tabular">{a.total}</td>
                        <td className="px-3 py-2 text-right tabular">{a.closed}</td>
                        <td className="px-3 py-2 text-right tabular">{duration(a.avg_first_response_seconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {report.by_outcome.length > 0 && (
              <section aria-labelledby="por-motivo" className="grid gap-2">
                <h2 id="por-motivo" className="text-sm font-semibold">
                  Como terminaram
                </h2>
                <ul className="grid gap-1 text-sm">
                  {report.by_outcome.map((o) => (
                    <li key={o.outcome} className="flex items-center justify-between gap-3 rounded-md border bg-surface px-3 py-2">
                      <span className="min-w-0 break-words">{o.outcome}</span>
                      <span className="tabular">{o.total}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
