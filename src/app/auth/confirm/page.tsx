"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Brand } from "@/components/app/brand";
import { safeNext } from "@/features/auth/schemas";

const OTP_TYPES: EmailOtpType[] = ["invite", "recovery", "signup", "magiclink", "email_change", "email"];

/**
 * Recebe os links de convite e recuperação de senha do Supabase em qualquer
 * formato (token_hash, code PKCE ou tokens no fragmento #) e abre a sessão.
 */
export default function ConfirmPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.slice(1));
    const q = url.searchParams;
    const type = (q.get("type") ?? hash.get("type")) as EmailOtpType | null;
    const next = safeNext(q.get("next"), type === "invite" || type === "recovery" ? "/definir-senha" : "/inicio");

    async function run() {
      const hashError = hash.get("error_description") ?? q.get("error_description");
      if (hashError) throw new Error(hashError);

      const tokenHash = q.get("token_hash");
      const code = q.get("code");
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");

      if (tokenHash && type && OTP_TYPES.includes(type)) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
        if (error) throw error;
      } else if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
      } else if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (error) throw error;
      } else {
        throw new Error("missing");
      }
      // Limpa tokens da barra de endereço antes de seguir.
      window.history.replaceState(null, "", url.pathname);
      router.replace(next);
      router.refresh();
    }

    run().catch(() => setError("Este link é inválido ou expirou. Peça um novo convite ou um novo link de recuperação."));
  }, [router]);

  return (
    <main id="conteudo" className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <Brand />
      {error ? (
        <div className="grid max-w-sm gap-3">
          <h1 className="text-xl font-semibold">Não foi possível abrir o link</h1>
          <p className="text-sm text-muted-foreground" role="alert">
            {error}
          </p>
          <Link href="/recuperar-senha" className="text-sm text-primary underline-offset-4 hover:underline">
            Pedir novo link de recuperação
          </Link>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          Validando seu acesso…
        </p>
      )}
    </main>
  );
}
