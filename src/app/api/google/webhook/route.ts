import { after, NextResponse, type NextRequest } from "next/server";
import { googleConfigured, syncUserQuietly, userForChannel } from "@/lib/google/calendar";

/**
 * Notificações push do Google Agenda. O Google não manda o conteúdo, só avisa
 * que algo mudou; validamos o canal e o token secreto e disparamos a
 * sincronização incremental em segundo plano. Sempre responde rápido.
 */
export async function POST(request: NextRequest) {
  if (!googleConfigured()) return new NextResponse(null, { status: 204 });
  const channelId = request.headers.get("x-goog-channel-id") ?? "";
  const channelToken = request.headers.get("x-goog-channel-token") ?? "";
  const state = request.headers.get("x-goog-resource-state") ?? "";

  const userId = await userForChannel(channelId, channelToken);
  if (!userId) return new NextResponse(null, { status: 404 });
  // "sync" é só a confirmação de abertura do canal.
  if (state !== "sync") after(() => syncUserQuietly(userId));
  return new NextResponse(null, { status: 204 });
}
