import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewPasswordForm } from "./new-password-form";

export const metadata: Metadata = { title: "Definir senha" };

export default async function DefinirSenhaPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/recuperar-senha?expirado=1");

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Defina sua senha</h1>
        <p className="text-sm text-muted-foreground">
          Use pelo menos 8 caracteres, com letras e números.
        </p>
      </div>
      <NewPasswordForm email={typeof data.claims.email === "string" ? data.claims.email : ""} />
    </div>
  );
}
