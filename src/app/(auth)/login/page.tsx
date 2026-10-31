import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  const reason = typeof sp.motivo === "string" ? sp.motivo : undefined;

  return (
    <div className="grid gap-8">
      <div className="grid gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Bem-vindo de volta</p>
        <h1 className="text-3xl font-semibold tracking-tight">Acesse sua área de trabalho</h1>
        <p className="text-sm leading-6 text-muted-foreground">Use o e-mail em que você recebeu o convite para continuar.</p>
      </div>
      <LoginForm next={next} reason={reason} />
    </div>
  );
}
