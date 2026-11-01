import { Check } from "lucide-react";
import { cn } from "cn";
import { formatInt, formatMoney, formatPct, formatRoas } from "../format";
import { PROVIDER_NAME, type Provider } from "../filters";
import { ratio, type Totals } from "../queries";

const COLOR: Record<Provider, string> = { meta_ads: "var(--chart-1)", google_ads: "var(--chart-4)" };
const ORDER: Provider[] = ["meta_ads", "google_ads"];

type Row = { label: string; value: (t: Totals) => number | null; show: (t: Totals) => string; better?: "high" | "low" };

/** Meta × Google no mesmo período: divisão do investimento e eficiência lado a lado. */
export function PlatformCompare({ byProvider, currency }: { byProvider: Record<Provider, Totals>; currency: string }) {
  const money = (c: number) => formatMoney(c, currency);
  const total = byProvider.meta_ads.spend + byProvider.google_ads.spend;
  const share = (p: Provider) => (total > 0 ? byProvider[p].spend / total : 0);

  const rows: Row[] = [
    { label: "Investimento", value: (t) => t.spend, show: (t) => money(t.spend) },
    { label: "Impressões", value: (t) => t.impressions, show: (t) => formatInt(t.impressions) },
    { label: "Cliques", value: (t) => t.clicks, show: (t) => formatInt(t.clicks) },
    { label: "CTR", value: (t) => ratio(t.clicks, t.impressions), show: (t) => formatPct(ratio(t.clicks, t.impressions)), better: "high" },
    { label: "CPC", value: (t) => (t.clicks ? t.spend / t.clicks : null), show: (t) => (t.clicks ? money(t.spend / t.clicks) : "—"), better: "low" },
    { label: "Conversões", value: (t) => t.conversions, show: (t) => t.conversions.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) },
    { label: "Custo por conversão", value: (t) => (t.conversions ? t.spend / t.conversions : null), show: (t) => (t.conversions ? money(t.spend / t.conversions) : "—"), better: "low" },
    { label: "Valor das conversões", value: (t) => t.conversionValue, show: (t) => money(t.conversionValue) },
    { label: "ROAS", value: (t) => (t.spend && t.conversionValue ? t.conversionValue / t.spend : null), show: (t) => formatRoas(t.conversionValue, t.spend), better: "high" },
  ];

  function winner(r: Row): Provider | null {
    if (!r.better) return null;
    const [a, b] = ORDER.map((p) => r.value(byProvider[p]));
    if (a === null || b === null || a === b) return null;
    return (r.better === "high" ? a > b : a < b) ? "meta_ads" : "google_ads";
  }

  return (
    <section aria-labelledby="comparativo" className="grid gap-5 rounded-xl border bg-surface p-4 sm:p-5">
      <div className="grid gap-1">
        <h2 id="comparativo" className="text-sm font-semibold">
          Meta Ads × Google Ads
        </h2>
        <p className="text-xs text-muted-foreground">Mesmo período e mesmos filtros. A marca indica a plataforma mais eficiente em cada indicador de custo e retorno.</p>
      </div>

      <figure className="grid gap-2">
        <figcaption className="sr-only">
          Participação no investimento: {ORDER.map((p) => `${PROVIDER_NAME[p]} ${formatPct(share(p))}`).join(", ")}.
        </figcaption>
        <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted/50" aria-hidden="true">
          {ORDER.map((p) => (share(p) > 0 ? <div key={p} style={{ width: `${share(p) * 100}%`, background: COLOR[p] }} /> : null))}
        </div>
        <div className="flex justify-between gap-4 text-xs" aria-hidden="true">
          {ORDER.map((p, i) => (
            <span key={p} className={cn("grid gap-0.5", i === 1 && "text-right")}>
              <span className={cn("inline-flex items-center gap-1.5 text-muted-foreground", i === 1 && "justify-end")}>
                <span className="size-2 rounded-sm" style={{ background: COLOR[p] }} />
                {PROVIDER_NAME[p]} · {Math.round(share(p) * 100)}%
              </span>
              <span className="tabular text-lg font-semibold">{money(byProvider[p].spend)}</span>
            </span>
          ))}
        </div>
      </figure>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">
                Indicador
              </th>
              {ORDER.map((p) => (
                <th key={p} scope="col" className="py-2 pl-3 text-right font-medium">
                  {PROVIDER_NAME[p]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const w = winner(r);
              return (
                <tr key={r.label} className="border-b last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-normal text-muted-foreground">
                    {r.label}
                  </th>
                  {ORDER.map((p) => (
                    <td key={p} className={cn("tabular py-2 pl-3 text-right", w === p && "font-semibold")}>
                      <span className="inline-flex items-center gap-1">
                        {w === p && (
                          <>
                            <Check className="size-3.5 text-success" aria-hidden="true" />
                            <span className="sr-only">Melhor: </span>
                          </>
                        )}
                        {r.show(byProvider[p])}
                      </span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
