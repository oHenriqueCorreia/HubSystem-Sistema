import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { FormAlert } from "@/components/app/form-field";
import { googleConfigured } from "@/lib/google/calendar";
import { GooglePanel } from "@/features/admin/components/google-panel";

export const metadata: Metadata = { title: "Integrações" };

const ERRORS: Record<string, string> = {
  indisponivel: "A integração não está disponível para você ou ainda não foi configurada.",
  cancelado: "A conexão foi cancelada no Google.",
  estado: "A solicitação expirou ou é inválida. Tente conectar novamente.",
  sem_refresh: "O Google não concedeu acesso contínuo. Remova o HubSystem em myaccount.google.com/permissions e conecte de novo.",
  falha: "Não foi possível concluir a conexão com o Google.",
};

export default async function IntegracoesPage({ searchParams }: PageProps<"/configuracoes/integracoes">) {
  const user = await requireUser();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_google_connection");
  const connection = (Array.isArray(data) ? data[0] : data) ?? null;
  const erro = typeof sp.erro === "string" ? ERRORS[sp.erro] : null;

  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Configurações" }, { label: "Integrações" }]} title="Integrações" />
      <PageBody className="grid gap-6">
        {erro && <FormAlert>{erro}</FormAlert>}
        {sp.conectado && <FormAlert tone="success">Google Agenda conectado. A primeira sincronização já foi feita.</FormAlert>}
        <section aria-labelledby="google" className="grid gap-3">
          <h2 id="google" className="text-base font-semibold">
            Google Agenda
          </h2>
          <GooglePanel configured={googleConfigured()} canManage={Boolean(user.permissions["calendar.manage"])} connection={connection} />
        </section>
        <section aria-labelledby="whatsapp" className="grid max-w-prose gap-2 text-sm">
          <h2 id="whatsapp" className="text-base font-semibold">
            WhatsApp
          </h2>
          <p className="text-muted-foreground">
            O sistema abre conversas pelo link oficial wa.me com a mensagem preenchida; o envio é sempre feito por você no WhatsApp. Envio automático exige a API oficial do WhatsApp
            Business (Meta), que pode ser integrada futuramente.
          </p>
        </section>
      </PageBody>
    </>
  );
}
