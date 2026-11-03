import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { NotificationSettings } from "@/features/notifications/components/notification-settings";
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from "@/features/notifications/types";

export const metadata: Metadata = { title: "Notificações" };

export default async function NotificacoesPage() {
  const user = await requireUser();
  const saved = (user.preferences.notificacoes ?? {}) as Partial<NotificationPrefs>;
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Configurações" }, { label: "Notificações" }]} title="Notificações" description="Escolha o que lembrar, com quanta antecedência e em quais aparelhos." />
      <PageBody>
        <NotificationSettings initial={{ ...DEFAULT_NOTIFICATION_PREFS, ...saved }} />
      </PageBody>
    </>
  );
}
