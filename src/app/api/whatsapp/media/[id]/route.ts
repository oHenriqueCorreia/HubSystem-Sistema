import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadMedia } from "@/lib/whatsapp";

const ALLOWED = /^(image\/(jpeg|png|webp)|audio\/(ogg|mpeg|mp4|aac|amr|webm)|video\/(mp4|3gpp|webm)|application\/pdf|application\/vnd\.openxmlformats-officedocument\.[\w.]+|application\/msword|text\/plain)/;

/** Entrega uma mídia recebida, só para quem enxerga a conversa (RLS). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user?.permissions["inbox.read"]) return new NextResponse(null, { status: 403 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 400 });

  const supabase = await createClient();
  const { data: msg } = await supabase.from("messages").select("media_id, media_mime, media_name, conversation:conversations(number_id)").eq("id", id).maybeSingle();
  const conv = msg && (Array.isArray(msg.conversation) ? msg.conversation[0] : msg.conversation);
  if (!msg?.media_id || !conv) return new NextResponse(null, { status: 404 });
  if (!ALLOWED.test(msg.media_mime ?? "")) return new NextResponse("Tipo de arquivo não permitido.", { status: 415 });
  // Arquivo guardado por nós (recebido pelo QR Code ou enviado pelo sistema).
  if (msg.media_id.startsWith("storage:")) {
    const { data, error } = await createAdminClient().storage.from("whatsapp-media").download(msg.media_id.slice("storage:".length));
    if (error || !data) return new NextResponse("O arquivo não está mais disponível.", { status: 410 });
    const inline = /^(image|audio|video)\//.test(msg.media_mime ?? "");
    return new NextResponse(data, {
      headers: {
        "Content-Type": msg.media_mime ?? "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${(msg.media_name ?? "arquivo").replace(/[^\w.\- ]/g, "_")}"`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  try {
    const media = await downloadMedia((conv as { number_id: string }).number_id, msg.media_id);
    return new NextResponse(media.body, {
      headers: {
        "Content-Type": media.mime,
        "Content-Disposition": `${msg.media_mime?.startsWith("image/") || msg.media_mime?.startsWith("audio/") ? "inline" : "attachment"}; filename="${(msg.media_name ?? "arquivo").replace(/[^\w.\- ]/g, "_")}"`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("A mídia não está mais disponível no WhatsApp.", { status: 410 });
  }
}
