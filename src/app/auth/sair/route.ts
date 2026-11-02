import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clearRememberChoice } from "@/lib/auth/remember";

/** Encerra a sessão local (usado quando o perfil foi desativado). */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  await clearRememberChoice();
  const motivo = request.nextUrl.searchParams.get("motivo");
  const url = new URL("/login", request.url);
  if (motivo && /^[a-z]+$/.test(motivo)) url.searchParams.set("motivo", motivo);
  return NextResponse.redirect(url);
}
