import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { getAdsReport, getAdsSetup } from "@/features/ads/queries";

const date = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
// Evita fórmula em planilhas (CSV injection) e escapa aspas.
const cell = (v: string | number) => {
  const s = String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** Relatório de campanhas do período em CSV (separador ;, UTF-8 com BOM para o Excel). */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.permissions["ads.read"]) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const q = request.nextUrl.searchParams;
  const from = date(q.get("de"));
  const to = date(q.get("ate"));
  if (!from || !to || from > to) return NextResponse.json({ error: "periodo" }, { status: 400 });

  const { accounts } = await getAdsSetup();
  const report = await getAdsReport(accounts, { from, to, prevFrom: from, prevTo: from, accountId: q.get("conta") ?? undefined, status: q.get("status") ?? undefined, group: "dia" });
  const header = ["Conta", "Campanha", "Status", "Investimento (R$)", "Impressões", "Cliques", "Conversões"];
  const lines = (report?.campaigns ?? []).map((c) =>
    [c.account, c.name, c.status ?? "", (c.metrics.spend / 100).toFixed(2).replace(".", ","), c.metrics.impressions, c.metrics.clicks, Math.round(c.metrics.conversions)].map(cell).join(";"),
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
