import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { formatDate, todayLocal } from "@/domain/shared/dates";

export const metadata: Metadata = { title: "Início" };

function greeting(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(now));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export default async function InicioPage() {
  const user = await requireUser();
  const firstName = user.fullName.split(" ")[0];

  return (
    <>
      <PageHeader title={`${greeting()}, ${firstName}`} description={`Hoje é ${formatDate(todayLocal())}.`} />
      <PageBody>
        <p className="text-sm text-muted-foreground">Sua área de trabalho aparecerá aqui.</p>
      </PageBody>
    </>
  );
}
