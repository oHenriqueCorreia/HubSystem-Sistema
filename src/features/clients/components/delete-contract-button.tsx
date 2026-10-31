"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { deleteContract } from "../actions";

export function DeleteContractButton({ id, clientId }: { id: string; clientId: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" className="text-danger">
          <Trash2 aria-hidden="true" /> Excluir
        </Button>
      }
      title="Excluir este contrato?"
      description="O contrato sai das listas e relatórios. A exclusão fica registrada na auditoria. Para apenas interromper, prefira mudar a situação para “Encerrado” ou “Cancelado”."
      confirmLabel="Excluir contrato"
      onConfirm={async () => {
        const res = await deleteContract({ id });
        if (!res.ok) {
          toast.error(res.message);
          return false;
        }
        toast.success(res.message);
        router.push(`/clientes/${clientId}`);
      }}
    />
  );
}
