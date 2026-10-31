import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getCurrentUser } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { exchangeCode, googleConfigured, syncUser, watchCalendar } from "@/lib/google/calendar";

function back(request: NextRequest, q: string) {
  const res = NextResponse.redirect(new URL(`/configuracoes/integracoes?${q}`, request.url));
  res.cookies.delete({ name: "g_oauth_state", path: "/api/google/oauth" });
  return res;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!googleConfigured()) return back(request, "erro=indisponivel");

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back(request, "erro=cancelado");

  const state = params.get("state") ?? "";
  const expected = request.cookies.get("g_oauth_state")?.value ?? "";
  if (!state || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
    return back(request, "erro=estado");
  }

  try {
    const t = await exchangeCode(params.get("code") ?? "");
    if (!t.refresh_token) return back(request, "erro=sem_refresh");
    const admin = createAdminClient();
    const { error } = await admin.from("google_calendar_connections").upsert({
      user_id: user.id,
      organization_id: user.organizationId,
      google_email: t.email,
      refresh_token_enc: encrypt(t.refresh_token),
      access_token_enc: encrypt(t.access_token),
      access_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
      sync_token: null,
      scopes: t.scopes,
      status: "ativa",
      last_error: null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    await syncUser(user.id).catch(() => null);
    await watchCalendar(user.id).catch(() => false);
    return back(request, "conectado=1");
  } catch {
    console.error("[google-oauth] falha na troca do código");
    return back(request, "erro=falha");
  }
}
