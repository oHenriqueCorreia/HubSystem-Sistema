import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  const reason = typeof sp.motivo === "string" ? sp.motivo : undefined;

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Entrar no HubSystem</h1>
        <p className="text-sm text-muted-foreground">Use o e-mail em que você recebeu o convite.</p>
      </div>
      <LoginForm next={next} reason={reason} />
    </div>
  );
}
