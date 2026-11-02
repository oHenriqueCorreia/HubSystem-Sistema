import Link from "next/link";
import { Kpi } from "@/features/dashboards/components/kpi";
import { formatMoney, formatPct, formatRoas } from "../format";
import { ratio, type CrmTotals } from "../queries";

/**
 * Do anúncio à venda: conversas de "Clique para WhatsApp" que viraram lead e
 * negócio ganho no funil. O valor vendido vem do CRM (reais); o ROAS real só
 * é calculado quando o investimento também está em reais.
 */
export function CrmFunnel({ crm, previous, spend, currency }: { crm: CrmTotals; previous: CrmTotals; spend: number; currency: string }) {
  const money = (c: number) => formatMoney(c, currency);
  const sameCurrency = currency === "BRL";
  const items: [string, string, string][] = [
    ["Custo por conversa", crm.conversations ? money(spend / crm.conversations) : "—", "Investimento na Meta ÷ conversas"],
    ["Custo por venda", crm.won ? money(spend / crm.won) : "—", "Investimento na Meta ÷ vendas"],
    ["ROAS real", sameCurrency ? formatRoas(crm.wonValue, spend) : "—", sameCurrency ? "Valor vendido no funil ÷ investimento" : "Disponível só para contas em reais"],
  ];

  return (
    <section aria-labelledby="anuncio-venda" className="grid gap-3">
      <div className="grid gap-0.5">
        <h2 id="anuncio-venda" className="text-sm font-semibold">
          Do anúncio à venda
        </h2>
        <p className="max-w-3xl text-xs text-muted-foreground">
          Conversas iniciadas por anúncios “Clique para WhatsApp” da Meta, pela data do primeiro contato. Vendas são negócios ganhos no funil depois desse contato.
        </p>
      </div>
      {crm.conversations === 0 ? (
        <p className="rounded-xl border border-dashed bg-surface px-4 py-6 text-sm text-muted-foreground">
          Nenhuma conversa veio de anúncios neste período. Quando alguém clicar num anúncio “Clique para WhatsApp” e chamar um número conectado em{" "}
          <Link href="/atendimento" className="font-medium text-primary hover:underline">
            Atendimento
          </Link>
          , a conversa aparece aqui e as vendas do funil entram no ROAS real.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Conversas no WhatsApp" value={crm.conversations} previous={previous.conversations} />
            <Kpi label="Viraram lead" value={crm.leads} previous={previous.leads} hint={`${formatPct(ratio(crm.leads, crm.conversations))} das conversas`} />
            <Kpi label="Vendas" value={crm.won} previous={previous.won} hint={`${formatPct(ratio(crm.won, crm.leads))} dos leads`} />
            <Kpi label="Valor vendido" value={crm.wonValue} previous={previous.wonValue} money />
          </dl>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {items.map(([label, value, hint]) => (
              <div key={label} className="grid content-start gap-1 rounded-xl border bg-surface p-4">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="tabular text-xl font-semibold">{value}</dd>
                <dd className="text-xs text-muted-foreground">{hint}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}
