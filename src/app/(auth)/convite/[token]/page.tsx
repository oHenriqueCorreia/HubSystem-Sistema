import type { Metadata } from "next";
import Link from "next/link";
import { previewInvitation } from "@/features/admin/invitations";
import { formatDateTime } from "@/domain/shared/dates";
import { AcceptInvitationForm } from "./accept-form";

export const metadata: Metadata = { title: "Aceitar convite", robots: { index: false } };

const PROBLEM = {
  expirado: { title: "Este convite expirou", text: "Peça a quem convidou para reenviar o convite. Um novo link será enviado por e-mail." },
  usado: { title: "Este convite já foi usado", text: "Sua conta já está ativa. Entre com seu e-mail e a senha que você criou." },
  cancelado: { title: "Este convite foi cancelado", text: "Se ainda precisa de acesso, fale com quem convidou você." },
  invalido: { title: "Convite não encontrado", text: "Confira se o link foi copiado inteiro ou peça um novo convite." },
} as const;

export default async function ConvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await previewInvitation(token);

  if (inv.state !== "valido") {
    const p = PROBLEM[inv.state];
    return (
      <div className="grid gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{p.title}</h1>
        <p className="text-sm text-muted-foreground">{p.text}</p>
        <Link href="/login" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Ir para o login
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {inv.mode === "ambiente" ? "Crie seu acesso ao Hub System" : `Entre na equipe ${inv.organizationName}`}
        </h1>
        <p className="text-sm text-muted-foreground">
          {inv.inviterName ? `${inv.inviterName} convidou você` : "Você foi convidado"}
          {inv.mode === "ambiente" ? ` para usar o Hub System com a empresa ${inv.organizationName}.` : ` como ${inv.roleName}.`}
        </p>
        <p className="text-xs text-muted-foreground">Convite válido até {formatDateTime(inv.expiresAt)}.</p>
      </div>
      <AcceptInvitationForm token={token} email={inv.email} defaultName={inv.fullName} />
    </div>
  );
}
