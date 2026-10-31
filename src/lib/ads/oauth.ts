import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";

const COOKIE = "ads_oauth_state";

/** Início do OAuth: exige ads.manage, grava o state em cookie e redireciona. */
export async function startOAuth(request: NextRequest, configured: boolean, authUrl: (state: string) => string, path: string) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!user.permissions["ads.manage"] || !configured) return NextResponse.redirect(new URL("/anuncios?erro=indisponivel", request.url));
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set(COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", path, maxAge: 600 });
  return res;
}

/** Retorno do OAuth: valida sessão, permissão e state (tempo constante). */
export async function checkCallback(request: NextRequest, path: string) {
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/anuncios?${q}`, request.url));
    res.cookies.delete({ name: COOKIE, path });
    return res;
  };
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.redirect(new URL("/login", request.url)) } as const;
  if (!user.permissions["ads.manage"]) return { error: back("erro=indisponivel") } as const;
  const params = request.nextUrl.searchParams;
  if (params.get("error")) return { error: back("erro=cancelado") } as const;
  const state = params.get("state") ?? "";
  const expected = request.cookies.get(COOKIE)?.value ?? "";
  if (!state || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) return { error: back("erro=estado") } as const;
  return { user, code: params.get("code") ?? "", back } as const;
}
