import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/** IP de quem fez a requisição (Vercel preenche x-forwarded-for). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "desconhecido";
}

/**
 * Janela fixa persistida no banco (funciona entre instâncias serverless).
 * Retorna true quando a chamada está dentro do limite. Sem a chave secreta
 * (ambiente local incompleto) ou com o banco indisponível, não bloqueia:
 * a proteção do Supabase Auth continua valendo.
 */
export async function withinRateLimit(bucket: string, max: number, windowSeconds: number): Promise<boolean> {
  if (!process.env.SUPABASE_SECRET_KEY) return true;
  try {
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
      p_bucket: bucket.slice(0, 200),
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

export const RATE_LIMIT_MESSAGE = "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.";
