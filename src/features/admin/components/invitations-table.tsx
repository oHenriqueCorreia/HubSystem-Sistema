"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { formatDateTime } from "@/domain/shared/dates";
import { cancelInvitation, resendInvitation } from "../invitations";
import type { InvitationListRow, InvitationState } from "../queries";

const STATE: Record<InvitationState, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pendente: { label: "Pendente", variant: "default" },
  aceito: { label: "Aceito", variant: "secondary" },
  expirado: { label: "Expirado", variant: "outline" },
  cancelado: { label: "Cancelado", variant: "outline" },
};

export function InvitationsTable({ invitations }: { invitations: InvitationListRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        if (res.message) toast.success(res.message);
        router.refresh();
      } else toast.error(res.message);
    });
  }

  if (!invitations.length) return null;

  return (
    <section aria-labelledby="convites-titulo" className="grid gap-3">
      <h2 id="convites-titulo" className="text-base font-semibold">
        Convites
      </h2>
      <div className="overflow-x-auto rounded-xl border bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Convidado</TableHead>
              <TableHead>Acesso</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Validade</TableHead>
              <TableHead>
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map((i) => {
              const open = i.state === "pendente" || i.state === "expirado";
              return (
                <TableRow key={i.id}>
                  <TableCell>
                    <div className="font-medium">{i.full_name || i.email}</div>
                    <div className="text-xs text-muted-foreground">{i.email}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {i.mode === "ambiente" ? `Ambiente próprio · ${i.workspace_name ?? ""}` : (i.role_name ?? "—")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATE[i.state].variant}>{STATE[i.state].label}</Badge>
                    {i.send_count > 1 && <span className="ml-2 text-xs text-muted-foreground">{i.send_count} envios</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {i.state === "aceito" && i.accepted_at ? `Aceito em ${formatDateTime(i.accepted_at)}` : formatDateTime(i.expires_at)}
                  </TableCell>
                  <TableCell>
                    {open && (
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => resendInvitation({ id: i.id }))}>
                          <Send aria-hidden="true" /> Reenviar
                        </Button>
                        {i.state === "pendente" && (
                          <ConfirmDialog
                            tone="danger"
                            trigger={
                              <Button variant="ghost" size="sm" disabled={pending}>
                                <Ban aria-hidden="true" /> Cancelar
                              </Button>
                            }
                            title={`Cancelar o convite de ${i.email}?`}
                            description="O link enviado deixa de funcionar imediatamente. Você pode convidar a pessoa de novo depois."
                            confirmLabel="Cancelar convite"
                            onConfirm={() => run(() => cancelInvitation({ id: i.id }))}
                          />
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
