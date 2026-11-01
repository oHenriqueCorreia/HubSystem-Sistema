import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { getAdsSetup, getCampaignsReport } from "@/features/ads/queries";
import { parseAdsFilters, PROVIDER_NAME, STATUS_LABEL } from "@/features/ads/filters";

const date = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
// Evita fórmula em planilhas (CSV injection) e escapa aspas.
const cell = (v: string | number) => {
  const s = String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
const decimal = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

/** Relatório de campanhas do período em CSV (separador ;, UTF-8 com BOM para o Excel). */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.permissions["ads.read"]) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const q = request.nextUrl.searchParams;
  const from = date(q.get("de"));
  const to = date(q.get("ate"));
  if (!from || !to || from > to) return NextResponse.json({ error: "periodo" }, { status: 400 });

  const filters = parseAdsFilters({ ...Object.fromEntries(q), periodo: "custom", de: from, ate: to });
  const { accounts } = await getAdsSetup();
  const campaigns = await getCampaignsReport(accounts, filters);
  const header = ["Plataforma", "Conta", "Campanha", "Status", "Investimento", "Impressões", "Cliques", "Conversões", "Valor das conversões", "ROAS"];
  const lines = campaigns.map((c) =>
    [
      PROVIDER_NAME[c.provider],
      c.account,
      c.name,
      STATUS_LABEL[c.status ?? ""] ?? c.status ?? "",
      decimal(c.metrics.spend),
      c.metrics.impressions,
      c.metrics.clicks,
      c.metrics.conversions.toFixed(1).replace(".", ","),
      decimal(c.metrics.conversionValue),
      c.metrics.spend && c.metrics.conversionValue ? (c.metrics.conversionValue / c.metrics.spend).toFixed(2).replace(".", ",") : "",
    ]
      .map(cell)
      .join(";"),
  );
  const body = "﻿" + [header.map(cell).join(";"), ...lines].join("\r\n");
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="anuncios-${from}-a-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
