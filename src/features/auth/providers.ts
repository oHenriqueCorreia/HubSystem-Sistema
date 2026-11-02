import "server-only";
import { publicEnv } from "@/lib/env";

/** Provedores de login ativos no Supabase (Authentication → Providers). Cache de 5 minutos. */
export async function enabledProviders(): Promise<{ google: boolean }> {
  try {
    const res = await fetch(`${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { google: false };
    const data = (await res.json()) as { external?: Record<string, boolean> };
    return { google: Boolean(data.external?.google) };
  } catch {
    return { google: false };
  }
}
