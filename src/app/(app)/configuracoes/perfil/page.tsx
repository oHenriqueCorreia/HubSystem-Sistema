import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { getMyProfile } from "@/features/admin/queries";
import { ProfileForm } from "@/features/admin/components/forms";
import { WorkHoursForm } from "@/features/home/components/work-hours-form";
import { DEFAULT_WORK_HOURS, type WorkHours } from "@/domain/calendar";

export const metadata: Metadata = { title: "Meu perfil" };

export default async function PerfilPage() {
  const user = await requireUser();
  const profile = await getMyProfile(user.id);
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Configurações" }, { label: "Meu perfil" }]} title="Meu perfil" description={`Papel: ${user.roles.map((r) => r.name).join(", ") || "—"}`} />
      <PageBody className="grid gap-10">
        <ProfileForm initial={profile} />
        <WorkHoursForm initial={(user.preferences.work_hours as WorkHours | undefined) ?? DEFAULT_WORK_HOURS} />
        <section aria-labelledby="seguranca" className="grid max-w-lg gap-2">
          <h2 id="seguranca" className="text-sm font-semibold">
            Senha
          </h2>
          <p className="text-sm text-muted-foreground">Para trocar a senha, abra a tela de nova senha. Você continua conectado.</p>
          <Button asChild variant="outline" className="justify-self-start">
            <Link href="/definir-senha">Trocar senha</Link>
          </Button>
        </section>
      </PageBody>
    </>
  );
}
