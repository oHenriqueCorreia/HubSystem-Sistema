import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { FormAlert } from "@/components/app/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { googleConfigured } from "@/lib/google/calendar";
import { GooglePanel } from "@/features/admin/components/google-panel";
import { getAdsSetup } from "@/features/ads/queries";
import { IntegrationGuide, SupportActions } from "@/features/integrations/components/integration-guide";
import { GUIDE_LIST, type IntegrationId } from "@/features/integrations/guides";

export const metadata: Metadata = { title: "Integrações" };

const ERRORS: Record<string, string> = {
  indisponivel: "A integração não está disponível para você ou ainda não foi configurada.",
  cancelado: "A conexão foi cancelada no Google.",
  estado: "A solicitação expirou ou é inválida. Tente conectar novamente.",
  sem_refresh: "O Google não concedeu acesso contínuo. Remova o HubSystem em myaccount.google.com/permissions e conecte de novo.",
  falha: "Não foi possível concluir a conexão com o Google.",
};

type State = "conectado" | "atencao" | "desconectado";
const LABEL: Record<State, string> = { conectado: "Conectado", atencao: "Precisa de atenção", desconectado: "Não conectado" };
const VARIANT = { conectado: "default", atencao: "destructive", desconectado: "outline" } as const;
const stateOf = (status: string | null | undefined): State => (!status ? "desconectado" : status === "ativa" || status === "ativo" ? "conectado" : "atencao");

export default async function IntegracoesPage({ searchParams }: PageProps<"/configuracoes/integracoes">) {
  const user = await requireUser();
  const sp = await searchParams;
  const supabase = await createClient();
  const [google, social, numbers, ads] = await Promise.all([
    supabase.rpc("my_google_connection"),
    supabase.rpc("my_social_connection"),
    supabase.rpc("my_whatsapp_numbers"),
    user.permissions["ads.read"] ? getAdsSetup() : Promise.resolve({ connections: [] as { provider: string; status: string }[] }),
  ]);
  const one = <T,>(d: T | T[] | null) => (Array.isArray(d) ? (d[0] ?? null) : d);
  const connection = one(google.data) ?? null;
  const live = ((numbers.data ?? []) as { status: string }[]).filter((n) => n.status !== "desconectado");
  const states: Record<IntegrationId, State> = {
    meta_social: stateOf((one(social.data) as { status?: string } | null)?.status),
    meta_ads: stateOf(ads.connections.find((c) => c.provider === "meta_ads")?.status),
    google_ads: stateOf(ads.connections.find((c) => c.provider === "google_ads")?.status),
    google_calendar: stateOf((connection as { status?: string } | null)?.status),
    whatsapp: !live.length ? "desconectado" : live.every((n) => n.status === "ativo") ? "conectado" : "atencao",
  };
  const erro = typeof sp.erro === "string" ? ERRORS[sp.erro] : null;

  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Configurações" }, { label: "Integrações" }]} title="Integrações" description="Veja o que já está conectado. Cada integração tem o passo a passo e o caminho para falar com o suporte." />
      <PageBody className="grid gap-6">
        {erro && <FormAlert>{erro}</FormAlert>}
        {sp.conectado && <FormAlert tone="success">Google Agenda conectado. A primeira sincronização já foi feita.</FormAlert>}

        <ul aria-label="Integrações disponíveis" className="grid gap-3 md:grid-cols-2">
          {GUIDE_LIST.map((g) => (
            <li key={g.id} className="grid content-start gap-2 rounded-xl border bg-surface p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">{g.name}</h2>
                <Badge variant={VARIANT[states[g.id]]}>{LABEL[states[g.id]]}</Badge>
              </div>
              <p className="text-muted-foreground">{g.purpose}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                <IntegrationGuide id={g.id} defaultOpen={g.id === "google_calendar" && Boolean(erro)} />
                {g.id !== "google_calendar" && user.permissions[g.permission as keyof typeof user.permissions] && (
                  <Button asChild size="sm" variant="ghost">
                    <Link href={g.href}>{states[g.id] === "desconectado" ? "Ir para conectar" : "Abrir"}</Link>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>

        <section aria-labelledby="google" className="grid gap-3">
          <h2 id="google" className="text-base font-semibold">
            Google Agenda
          </h2>
          <GooglePanel configured={googleConfigured()} canManage={Boolean(user.permissions["calendar.manage"])} connection={connection} />
        </section>

        <section aria-labelledby="ajuda" className="grid max-w-prose gap-2 text-sm">
          <h2 id="ajuda" className="text-base font-semibold">
            Precisa de ajuda?
          </h2>
          <p className="text-muted-foreground">Se o passo a passo não resolver, fale com o suporte.</p>
          <SupportActions name="uma integração" />
        </section>
      </PageBody>
    </>
  );
}
