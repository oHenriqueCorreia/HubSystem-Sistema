import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";

/**
 * Cliente com a chave secreta: IGNORA a RLS.
 * Usar apenas em operações administrativas já autorizadas no servidor
 * (convite de usuário, bloqueio de sessão, integrações).
 */
export function createAdminClient() {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
