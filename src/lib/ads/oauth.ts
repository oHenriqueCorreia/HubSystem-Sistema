import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import type { PermissionKey } from "@/domain/permissions";

const COOKIE = "ads_oauth_state";

type Target = { permission: PermissionKey; backTo: string };
const ADS: Target = { permission: "ads.manage", backTo: "/anuncios/contas" };
const withQuery = (path: string, q: string) => `${path}${path.includes("?") ? "&" : "?"}${q}`;

/** Início do OAuth: exige ads.manage, grava o state em cookie e redireciona. */
export async function startOAuth(request: NextRequest, configured: boolean, authUrl: (state: string) => string, path: string, target: Target = ADS) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!user.permissions[target.permission] || !configured) return NextResponse.redirect(new URL(withQuery(target.backTo, "erro=indisponivel"), request.url));
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set(COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", path, maxAge: 600 });
  return res;
}

/** Retorno do OAuth: valida sessão, permissão e state (tempo constante). */
export async function checkCallback(request: NextRequest, path: string, target: Target = ADS) {
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(withQuery(target.backTo, q), request.url));
    res.cookies.delete({ name: COOKIE, path });
    return res;
  };
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.redirect(new URL("/login", request.url)) } as const;
  if (!user.permissions[target.permission]) return { error: back("erro=indisponivel") } as const;
  const params = request.nextUrl.searchParams;
  if (params.get("error")) return { error: back("erro=cancelado") } as const;
  const state = params.get("state") ?? "";
  const expected = request.cookies.get(COOKIE)?.value ?? "";
  if (!state || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) return { error: back("erro=estado") } as const;
  return { user, code: params.get("code") ?? "", back } as const;
}
