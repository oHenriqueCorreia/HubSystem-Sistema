import type { Metadata } from "next";
import Link from "next/link";
import { ResetRequestForm } from "./reset-request-form";

export const metadata: Metadata = { title: "Recuperar senha" };

export default function RecuperarSenhaPage() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Recuperar senha</h1>
        <p className="text-sm text-muted-foreground">
          Enviaremos um link para você criar uma nova senha. O link vale por 1 hora.
        </p>
      </div>
      <ResetRequestForm />
      <Link href="/login" className="justify-self-start text-sm text-primary underline-offset-4 hover:underline">
        Voltar para o login
      </Link>
    </div>
  );
}
