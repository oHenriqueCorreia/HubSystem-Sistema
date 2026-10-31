import { getCurrentUser } from "@/lib/auth/dal";
import { getCrmLookups, listLeads, type LeadFilters } from "@/features/crm/queries";
import type { LeadListItem } from "@/features/crm/types";
import { csvLine } from "@/domain/crm/export";

const HEADERS = ["Nome", "Telefone", "WhatsApp", "E-mail", "Cidade", "Estado", "Categoria", "Segmento", "Etapa", "Etiquetas", "Status", "Responsável", "Último contato", "Próximo contato", "Criado em"];

function filterValue(params: URLSearchParams, key: string): string | undefined {
  return params.get(key)?.trim().slice(0, 100) || undefined;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sessão necessária.", { status: 401 });
  if (!user.permissions["crm.leads.read"]) return new Response("Sem acesso.", { status: 403 });

  const params = new URL(request.url).searchParams;
  const contact = filterValue(params, "contato");
  const order = filterValue(params, "ordem");
  const filters: LeadFilters = {
    q: filterValue(params, "q"),
    etapa: filterValue(params, "etapa"),
    responsavel: filterValue(params, "responsavel"),
    segmento: filterValue(params, "segmento"),
    etiqueta: filterValue(params, "etiqueta"),
    status: filterValue(params, "status"),
    contato: contact === "atrasado" || contact === "hoje" || contact === "sem" ? contact : undefined,
    ordem: order === "nome" || order === "proximo" || order === "ultimo" ? order : "recentes",
  };

  const lookups = await getCrmLookups();
  const pipelineId = lookups.pipelines[0]?.id;
  const stages = new Map(lookups.pipelines.flatMap((pipeline) => pipeline.stages.map((stage) => [stage.id, stage.name] as const)));
  const owners = new Map(lookups.owners.map((owner) => [owner.id, owner.full_name || owner.email] as const));
  const encoder = new TextEncoder();
  let page = 1;
  let pageCount = 1;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await listLeads({ ...filters, pagina: page }, pipelineId, 1000);
        pageCount = result.pageCount;
        const rows = result.rows.map((lead: LeadListItem) => csvLine([
          lead.name, lead.phone_e164, lead.whatsapp_e164, lead.email, lead.city, lead.state,
          lead.category, lead.segment?.name, lead.deal ? stages.get(lead.deal.stage_id) : "",
          lead.tags.map((tag) => tag.name).join(", "), lead.status,
          lead.owner_id ? owners.get(lead.owner_id) : "", lead.last_contact_at,
          lead.next_contact_at, lead.created_at,
        ]));
        controller.enqueue(encoder.encode(`${page === 1 ? `\uFEFF${csvLine(HEADERS)}` : ""}${rows.join("")}`));
        if (page++ >= pageCount) controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hub-system-leads-${date}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
