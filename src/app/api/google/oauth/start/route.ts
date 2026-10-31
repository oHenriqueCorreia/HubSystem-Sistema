import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { getCurrentUser } from "@/lib/auth/dal";
import { authUrl, googleConfigured } from "@/lib/google/calendar";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!user.permissions["calendar.manage"] || !googleConfigured()) {
    return NextResponse.redirect(new URL("/configuracoes/integracoes?erro=indisponivel", request.url));
  }
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set("g_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/google/oauth", maxAge: 600 });
  return res;
}
