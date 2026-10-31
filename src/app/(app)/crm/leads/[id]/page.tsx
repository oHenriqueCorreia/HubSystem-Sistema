import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExternalLink, Globe, Mail, MapPin, Pencil, Phone, Star } from "lucide-react";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { canOnRecord } from "@/domain/permissions";
import { formatPhone } from "@/domain/shared/phone";
import { formatDate, formatDateTime } from "@/domain/shared/dates";
import { getCrmLookups, getLead, getLeadActivities } from "@/features/crm/queries";
import { ACTIVITY_LABEL } from "@/features/crm/types";
import { WhatsAppButton } from "@/features/crm/components/whatsapp-button";
import { LeadFormDialog } from "@/features/crm/components/lead-form-dialog";
import {
  ActivityComposer,
  DealPanel,
  DeleteLeadButton,
  NextActionPanel,
  OwnerSelect,
  TagEditor,
} from "@/features/crm/components/lead-panels";
import { LeadExtraSections } from "@/features/crm/components/lead-extra-sections";
import { getClientByLead, listAttachments, listServices } from "@/features/clients/queries";
import { ConvertDialog } from "@/features/clients/components/convert-dialog";
import { Attachments } from "@/features/clients/components/attachments";
import Link from "next/link";
import { BriefcaseBusiness } from "lucide-react";

export async function generateMetadata({ params }: PageProps<"/crm/leads/[id]">): Promise<Metadata> {
  const { id } = await params;
  const data = await getLead(id).catch(() => null);
  return { title: data?.lead.name ?? "Lead" };
}

export default async function LeadPage({ params }: PageProps<"/crm/leads/[id]">) {
  const user = await requirePermission("crm.leads.read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [data, lookups, activities, client, services, attachments] = await Promise.all([
    getLead(id),
    getCrmLookups(),
    getLeadActivities(id),
    getClientByLead(id),
    listServices(),
    listAttachments("lead", id),
  ]);
  if (!data) notFound();
  const { lead, deals } = data;

  const canEdit = canOnRecord(user.permissions, "crm.leads.update", lead.owner_id, user.id);
  const canDelete = canOnRecord(user.permissions, "crm.leads.delete", lead.owner_id, user.id);
  const canMove = Boolean(user.permissions["crm.pipeline.move"]);
  const canAssign = Boolean(user.permissions["crm.leads.assign"]);
  const ownerName = lookups.owners.find((o) => o.id === lead.owner_id)?.full_name;
  const nameById = new Map(lookups.owners.map((o) => [o.id, o.full_name || o.email]));
  const vars = { nome: lead.name, empresa: lead.company_name || lead.name, responsavel: user.fullName };

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Leads", href: "/crm/leads" }, { label: lead.name }]}
        title={lead.name}
        description={[lead.category, [lead.city, lead.state].filter(Boolean).join(" – "), lead.segment?.name].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            <WhatsAppButton
              leadId={lead.id}
              dealId={deals[0]?.id}
              phone={lead.whatsapp_e164}
              vars={vars}
              templates={lookups.templates}
              defaultMessage={lookups.whatsappDefault}
              size="default"
              label="Conversar no WhatsApp"
            />
            {canEdit && (
              <LeadFormDialog
                lead={lead}
                lookups={lookups}
                canAssign={canAssign}
                trigger={
                  <Button variant="outline">
                    <Pencil aria-hidden="true" /> Editar
                  </Button>
                }
              />
            )}
            {client ? (
              <Button asChild variant="outline">
                <Link href={`/clientes/${client.id}`}>
                  <BriefcaseBusiness aria-hidden="true" /> Ver cliente
                </Link>
              </Button>
            ) : (
              user.permissions["clients.create"] && (
                <ConvertDialog
                  lead={{ id: lead.id, name: lead.name, email: lead.email, phone: lead.phone_e164 }}
                  dealId={deals[0]?.id ?? null}
                  services={services}
                  interest={lead.services_interest}
                />
              )
            )}
            {canDelete && <DeleteLeadButton leadId={lead.id} name={lead.name} />}
          </>
        }
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid content-start gap-6">
            <NextActionPanel leadId={lead.id} at={lead.next_contact_at} canEdit={canEdit} />

            <LeadExtraSections lead={{ id: lead.id, name: lead.name }} user={user} owners={lookups.owners} />

            <Attachments entityType="lead" entityId={lead.id} initial={attachments} canUpload={canEdit} />

            <section aria-labelledby="linha-do-tempo" className="grid gap-3">
              <h2 id="linha-do-tempo" className="text-sm font-semibold">
                Linha do tempo
              </h2>
              <ActivityComposer leadId={lead.id} dealId={deals[0]?.id ?? null} />
              {activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma interação registrada ainda.</p>
              ) : (
                <ol className="relative grid gap-4 border-l pl-4">
                  {activities.map((a) => (
                    <li key={a.id} className="relative">
                      <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background bg-primary" aria-hidden="true" />
                      <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{ACTIVITY_LABEL[a.type]}</span>
                        <time dateTime={a.occurred_at}>{formatDateTime(a.occurred_at)}</time>
                        {a.created_by && <span>· {nameById.get(a.created_by) ?? "Usuário"}</span>}
                      </div>
                      {a.content && <p className="mt-0.5 text-sm whitespace-pre-wrap">{a.content}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <aside className="grid content-start gap-6" aria-label="Dados do lead">
            <DealPanel leadId={lead.id} deals={deals} lookups={lookups} canMove={canMove} canEdit={canEdit} />

            <section aria-labelledby="contato" className="grid gap-2 text-sm">
              <h2 id="contato" className="text-sm font-semibold">
                Contato
              </h2>
              <dl className="grid gap-2">
                <Item icon={<Phone className="size-4" />} label="Telefone">
                  {lead.phone_e164 ? (
                    <a href={`tel:${lead.phone_e164}`} className="hover:underline">
                      {formatPhone(lead.phone_e164)}
                    </a>
                  ) : (
                    "—"
                  )}
                  {lead.phone_type && lead.phone_type !== "desconhecido" && <span className="text-muted-foreground"> · {lead.phone_type}</span>}
                </Item>
                <Item icon={<Mail className="size-4" />} label="E-mail">
                  {lead.email ? (
                    <a href={`mailto:${lead.email}`} className="break-all hover:underline">
                      {lead.email}
                    </a>
                  ) : (
                    "—"
                  )}
                </Item>
                <Item icon={<Globe className="size-4" />} label="Site">
                  {lead.website ? (
                    <a href={lead.website} target="_blank" rel="noopener noreferrer" className="break-all hover:underline">
                      {lead.website.replace(/^https?:\/\//, "")}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">Sem site — oportunidade</span>
                  )}
                </Item>
                <Item icon={<MapPin className="size-4" />} label="Endereço">
                  {lead.address || [lead.neighborhood, lead.city, lead.state].filter(Boolean).join(", ") || "—"}
                  {lead.zip && <span className="text-muted-foreground"> · {lead.zip}</span>}
                </Item>
              </dl>
            </section>

            {(lead.gmb_url || lead.gmb_rating != null) && (
              <section aria-labelledby="gmn" className="grid gap-2 text-sm">
                <h2 id="gmn" className="text-sm font-semibold">
                  Google Meu Negócio
                </h2>
                {lead.gmb_rating != null && (
                  <p className="flex items-center gap-1">
                    <Star className="size-4 fill-current text-warning" aria-hidden="true" />
                    <span className="tabular">{lead.gmb_rating.toLocaleString("pt-BR")}</span>
                    <span className="text-muted-foreground">({lead.gmb_reviews_count ?? 0} avaliações)</span>
                  </p>
                )}
                {lead.gmb_url && (
                  <a href={lead.gmb_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    Abrir no Google Maps <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                )}
              </section>
            )}

            <section aria-labelledby="responsavel" className="grid gap-2 text-sm">
              <h2 id="responsavel" className="text-sm font-semibold">
                Responsável
              </h2>
              {canAssign ? <OwnerSelect leadId={lead.id} ownerId={lead.owner_id} lookups={lookups} /> : <p>{ownerName ?? "Sem responsável"}</p>}
            </section>

            <section aria-labelledby="etiquetas" className="grid gap-2 text-sm">
              <h2 id="etiquetas" className="text-sm font-semibold">
                Etiquetas
              </h2>
              <TagEditor leadId={lead.id} current={lead.tags} all={lookups.tags} canEdit={canEdit} />
            </section>

            {lead.services_interest.length > 0 && (
              <section aria-labelledby="servicos" className="grid gap-2 text-sm">
                <h2 id="servicos" className="text-sm font-semibold">
                  Serviços de interesse
                </h2>
                <ul className="flex flex-wrap gap-1.5">
                  {lead.services_interest.map((s) => (
                    <li key={s} className="rounded border px-1.5 py-0.5 text-xs">
                      {s}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {lead.notes && (
              <section aria-labelledby="obs" className="grid gap-2 text-sm">
                <h2 id="obs" className="text-sm font-semibold">
                  Observações
                </h2>
                <p className="whitespace-pre-wrap text-muted-foreground">{lead.notes}</p>
              </section>
            )}

            <p className="text-xs text-muted-foreground">
              Criado em {formatDate(lead.created_at)}
              {lead.source ? ` · Origem: ${lead.source}` : ""}
              {lead.last_contact_at ? ` · Último contato em ${formatDate(lead.last_contact_at)}` : ""}
            </p>
          </aside>
        </div>
      </PageBody>
    </>
  );
}

function Item({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="mt-0.5 text-muted-foreground">
        <span aria-hidden="true">{icon}</span>
        <span className="sr-only">{label}</span>
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
