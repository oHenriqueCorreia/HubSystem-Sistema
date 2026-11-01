import { ExternalLink, ImageOff } from "lucide-react";
import { formatInt, formatMoney, formatPct, formatRoas } from "../format";
import { ratio, type AdRow } from "../queries";
import { ProviderTag, StatusText } from "./report";

function hostOf(url: string | null) {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

/** Anúncio com o criativo (miniatura ou texto) e as métricas do período. */
export function AdCard({ ad, currency, showCampaign = true }: { ad: AdRow; currency: string; showCampaign?: boolean }) {
  const m = ad.metrics;
  const money = (c: number) => formatMoney(c, currency);
  const host = hostOf(ad.link_url);

  return (
    <article className="grid content-start overflow-hidden rounded-xl border bg-surface text-sm">
      {ad.image_url ? (
        // Miniatura servida pela Meta (domínio externo, URL renovada a cada sincronização).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ad.image_url} alt={ad.headline ? `Criativo: ${ad.headline}` : `Criativo do anúncio ${ad.name}`} width={320} height={320} loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full bg-muted object-cover" />
      ) : ad.headline || ad.body ? (
        <div className="grid aspect-square content-center gap-1.5 bg-muted/40 p-4">
          {host && <span className="truncate text-xs text-muted-foreground">{host}</span>}
          {ad.headline && <p className="line-clamp-3 font-medium text-primary">{ad.headline}</p>}
          {ad.body && <p className="line-clamp-4 text-xs text-muted-foreground">{ad.body}</p>}
        </div>
      ) : (
        <div className="grid aspect-square place-items-center bg-muted/40 text-muted-foreground">
          <span className="grid justify-items-center gap-1 text-xs">
            <ImageOff className="size-5" aria-hidden="true" />
            Sem prévia do criativo
          </span>
        </div>
      )}
      <div className="grid gap-3 p-3">
        <div className="grid gap-1">
          <h3 className="line-clamp-2 font-medium break-words" title={ad.name}>
            {ad.name}
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <StatusText status={ad.status} />
            <ProviderTag provider={ad.provider} />
            {ad.format && <span className="text-muted-foreground">{ad.format}</span>}
          </div>
          {showCampaign && <p className="truncate text-xs text-muted-foreground" title={ad.campaign}>{ad.campaign}</p>}
        </div>
        {ad.image_url && ad.body && <p className="line-clamp-2 text-xs text-muted-foreground">{ad.body}</p>}
        <dl className="grid grid-cols-3 gap-x-2 gap-y-2 border-t pt-3 text-xs">
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">Investimento</dt>
            <dd className="tabular font-semibold">{money(m.spend)}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">Cliques</dt>
            <dd className="tabular">{formatInt(m.clicks)}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">CTR</dt>
            <dd className="tabular">{formatPct(ratio(m.clicks, m.impressions))}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">Conversões</dt>
            <dd className="tabular">{m.conversions.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">Custo/conv.</dt>
            <dd className="tabular">{m.conversions ? money(m.spend / m.conversions) : "—"}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">ROAS</dt>
            <dd className="tabular">{formatRoas(m.conversionValue, m.spend)}</dd>
          </div>
        </dl>
        {ad.link_url && (
          <a href={ad.link_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 justify-self-start text-xs font-medium text-primary hover:underline">
            {ad.provider === "meta_ads" ? "Ver prévia na Meta" : "Abrir página de destino"}
            <ExternalLink className="size-3" aria-hidden="true" />
            <span className="sr-only">(abre em nova aba)</span>
          </a>
        )}
      </div>
    </article>
  );
}
