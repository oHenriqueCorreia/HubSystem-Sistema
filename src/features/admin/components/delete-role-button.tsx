"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { deleteRole } from "../actions";

export function DeleteRoleButton({ roleId, name }: { roleId: string; name: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" className="text-danger">
          <Trash2 aria-hidden="true" /> Excluir papel
        </Button>
      }
      title={`Excluir o papel “${name}”?`}
      description="Só é possível excluir papéis sem usuários. Esta ação não pode ser desfeita."
      confirmLabel="Excluir papel"
      onConfirm={async () => {
        const res = await deleteRole({ roleId });
        if (!res.ok) {
          toast.error(res.message);
          return false;
        }
        toast.success(res.message);
        router.push("/configuracoes/papeis");
      }}
    />
  );
}
