import type { Metadata } from "next";
import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import { drivePreviewUrl } from "@/domain/content";
import { formatDateTime } from "@/domain/shared/dates";
import { getReviewByToken } from "@/features/content/queries";
import { ReviewForm } from "@/features/content/components/review-form";

// Link privado: não entra em busca nem manda o endereço a outros sites.
export const metadata: Metadata = { title: "Aprovação de conteúdo", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function AprovarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) notFound();
  const review = await getReviewByToken(createHash("sha256").update(token).digest("hex"));
  if (!review) notFound();
  const images = review.assets.filter((a) => a.kind === "imagem" && a.url);
  const videos = review.assets.filter((a) => a.kind === "video_drive");

  return (
    <main className="mx-auto grid max-w-2xl gap-6 px-4 py-8">
      <header className="grid gap-1">
        {review.organization && <p className="text-sm text-muted-foreground">{review.organization} enviou este conteúdo para você revisar.</p>}
        <h1 className="text-2xl font-semibold text-balance break-words">{review.title}</h1>
      </header>

      {images.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {images.map((a) => (
            <li key={a.id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- link assinado e temporário do armazenamento privado */}
              <img src={a.url!} alt={a.file_name ?? "Imagem do conteúdo"} width={640} height={640} className="h-auto w-full rounded-lg border" />
            </li>
          ))}
        </ul>
      )}
      {videos.map((v) => (
        <div key={v.id} className="grid gap-1">
          <iframe src={drivePreviewUrl(v.drive_file_id!)} title="Vídeo do conteúdo" allow="autoplay" className="aspect-video w-full rounded-lg border" />
          {v.drive_status === "inacessivel" && <p className="text-sm text-danger">Este vídeo pode não abrir para você. Avise a equipe se aparecer um pedido de acesso.</p>}
        </div>
      ))}

      <section aria-labelledby="legenda" className="grid gap-1">
        <h2 id="legenda" className="text-sm font-semibold">
          Legenda
        </h2>
        <p className="rounded-lg border bg-surface p-3 text-sm break-words whitespace-pre-wrap">{review.caption || "Sem legenda."}</p>
      </section>

      {review.open ? (
        <ReviewForm token={token} />
      ) : review.review && !review.outdated ? (
        <p role="status" className="rounded-lg border bg-muted/40 p-3 text-sm">
          {review.review.decision === "aprovado" ? "Aprovado" : "Ajustes pedidos"} por {review.review.reviewer_name} em {formatDateTime(review.review.created_at)}.
          {review.review.comment && <span className="mt-1 block whitespace-pre-wrap">{review.review.comment}</span>}
        </p>
      ) : (
        <p role="status" className="rounded-lg border bg-muted/40 p-3 text-sm">
          {review.expired ? "Este link expirou. Peça um novo à equipe." : "Este conteúdo foi alterado depois do envio. Peça o link da versão atual à equipe."}
        </p>
      )}
    </main>
  );
}
