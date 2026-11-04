import type { Metadata } from "next";
import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock, Download, FileText, XCircle } from "lucide-react";
import { cn } from "cn";
import { drivePreviewUrl } from "@/domain/content";
import type { DeliveryStatus } from "@/domain/deliveries";
import { formatDateTime } from "@/domain/shared/dates";
import { DeliveryDecision } from "@/features/tasks/components/delivery-decision";
import { getDeliveryPortal } from "@/features/tasks/delivery-queries";
import type { Delivery } from "@/features/tasks/delivery-types";

// Link privado: não entra em busca nem manda o endereço a outros sites.
export const metadata: Metadata = { title: "Aprovação", robots: { index: false, follow: false }, referrer: "no-referrer" };

// Quem lê é o cliente: "aguardando" aqui é a decisão dele.
const STATUS: Record<DeliveryStatus, { icon: typeof Clock; tone: string; label: string }> = {
  aguardando: { icon: Clock, tone: "text-warning", label: "Aguardando sua decisão" },
  aprovado: { icon: CheckCircle2, tone: "text-success", label: "Aprovado" },
  recusado: { icon: XCircle, tone: "text-danger", label: "Recusado. A equipe está ajustando" },
};
const PLURAL: Record<DeliveryStatus, [string, string]> = {
  aguardando: ["Aguardando você", "Aguardando você"],
  aprovado: ["Aprovada", "Aprovadas"],
  recusado: ["Recusada", "Recusadas"],
};
const DECISION = { aprovado: "Aprovou", recusado: "Recusou", comentario: "Comentou" };

function Media({ delivery }: { delivery: Delivery }) {
  const files = delivery.files;
  if (!files.length) return <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">A equipe ainda está enviando os arquivos desta entrega.</p>;
  return (
    <div className="grid gap-3">
      {files.map((f) =>
        f.kind === "imagem" && f.url ? (
          <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${f.file_name} em tamanho real`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- link assinado e temporário do armazenamento privado */}
            <img src={f.url} alt={f.file_name} width={960} height={960} className="h-auto max-h-[80dvh] w-full rounded-lg border bg-muted object-contain" />
          </a>
        ) : f.kind === "video" && f.url ? (
          <video key={f.id} controls playsInline preload="metadata" src={f.url} className="max-h-[80dvh] w-full rounded-lg border bg-black" />
        ) : f.kind === "drive" ? (
          <iframe key={f.id} src={drivePreviewUrl(f.drive_file_id!)} title={f.file_name} allow="autoplay" loading="lazy" className="aspect-video w-full rounded-lg border" />
        ) : f.url ? (
          <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center gap-2 rounded-lg border bg-surface p-3 text-sm font-medium hover:bg-accent">
            <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 break-words">{f.file_name}</span>
            <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </a>
        ) : null,
      )}
    </div>
  );
}

export default async function EntregaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) notFound();
  const portal = await getDeliveryPortal(createHash("sha256").update(token).digest("hex"));
  if (!portal) notFound();
  if (!portal.open) {
    return (
      <main className="mx-auto grid max-w-xl gap-2 px-4 py-12">
        <h1 className="text-xl font-semibold">Este link não está mais ativo</h1>
        <p className="text-sm text-muted-foreground">Peça um novo link à equipe que enviou este material.</p>
      </main>
    );
  }
  const counts = (["aguardando", "aprovado", "recusado"] as const).map((s) => ({ status: s, total: portal.deliveries.filter((d) => d.status === s).length }));

  return (
    <main className="mx-auto grid max-w-2xl gap-8 px-4 py-8">
      <header className="grid gap-4">
        <div className="grid gap-1">
          {portal.organization && <p className="text-sm text-muted-foreground">{portal.organization} enviou este material para você revisar.</p>}
          <h1 className="text-2xl font-semibold text-balance break-words">{portal.title}</h1>
          {portal.client && <p className="text-sm text-muted-foreground break-words">{portal.client}</p>}
        </div>
        <dl aria-label="Resumo das aprovações" className="grid grid-cols-3 divide-x rounded-xl border bg-surface">
          {counts.map(({ status, total }) => {
            const { icon: Icon, tone } = STATUS[status];
            return (
              <div key={status} className="grid justify-items-center gap-0.5 px-1 py-3 text-center">
                <dt className="order-2 text-xs text-muted-foreground">{PLURAL[status][total === 1 ? 0 : 1]}</dt>
                <dd className="order-1 flex items-center gap-1.5 text-2xl font-semibold tabular">
                  <Icon className={cn("size-5", total ? tone : "text-muted-foreground")} aria-hidden="true" />
                  {total}
                </dd>
              </div>
            );
          })}
        </dl>
      </header>

      {portal.deliveries.length === 0 && <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">A equipe ainda não enviou nada para você revisar.</p>}

      {portal.deliveries.map((d) => {
        const { icon: Icon, tone, label } = STATUS[d.status];
        return (
          <section key={d.id} aria-labelledby={`entrega-${d.id}`} className="grid gap-4 border-t pt-6 first-of-type:border-t-0 first-of-type:pt-0">
            <div className="grid gap-1">
              <p className="text-sm text-muted-foreground">
                {d.kind}
                {d.version > 1 && `, versão ${d.version}`}
              </p>
              <h2 id={`entrega-${d.id}`} className="text-lg font-semibold break-words">
                {d.title}
              </h2>
              <p className={cn("flex items-center gap-1.5 text-sm font-medium", tone)}>
                <Icon className="size-4" aria-hidden="true" /> {label}
              </p>
              {(d.maker_name || d.maker_role) && <p className="text-sm text-muted-foreground break-words">Feito por {[d.maker_name, d.maker_role].filter(Boolean).join(", ")}</p>}
            </div>
            <Media delivery={d} />
            {d.notes && <p className="rounded-lg border bg-surface p-3 text-sm break-words whitespace-pre-wrap">{d.notes}</p>}
            {d.files.length > 0 && <DeliveryDecision token={token} deliveryId={d.id} version={d.version} status={d.status} title={d.title} />}
            {d.reviews.length > 0 && (
              <div className="grid gap-3">
                <h3 className="text-sm font-semibold">Comentários e decisões</h3>
                <ul className="grid gap-3">
                  {d.reviews.map((r) => (
                    <li key={r.id} className="grid gap-2 rounded-lg border bg-surface p-3 text-sm">
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{r.reviewer_name}</span> {DECISION[r.decision].toLowerCase()} a versão {r.version} em {formatDateTime(r.created_at)}
                      </p>
                      {r.comment && <p className="break-words whitespace-pre-wrap">{r.comment}</p>}
                      {r.files.map((f) =>
                        !f.url ? null : f.kind === "audio" ? (
                          <audio key={f.id} controls preload="metadata" src={f.url} aria-label={`Áudio de ${r.reviewer_name}`} className="w-full" />
                        ) : (
                          <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" aria-label="Abrir imagem de referência">
                            {/* eslint-disable-next-line @next/next/no-img-element -- link assinado e temporário do armazenamento privado */}
                            <img src={f.url} alt="Imagem de referência" width={240} height={240} loading="lazy" className="h-auto max-h-60 w-auto rounded-md border" />
                          </a>
                        ),
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        );
      })}
    </main>
  );
}
