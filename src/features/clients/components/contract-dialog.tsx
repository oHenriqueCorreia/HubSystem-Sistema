"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormAlert } from "@/components/app/form-field";
import { createContract, updateContract } from "../actions";
import { contractFormSchema, type ContractFormValues } from "../schemas";
import type { Contract, Service } from "../types";
import { ContractFields, emptyContract, issuesToMap } from "./contract-fields";

export function ContractDialog({
  trigger,
  clientId,
  contract,
  services,
  owners,
}: {
  trigger: ReactNode;
  clientId: string;
  contract?: Contract;
  services: Service[];
  owners?: { id: string; full_name: string; email: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [value, setValue] = useState<ContractFormValues>(() =>
    contract
      ? {
          title: contract.title,
          serviceId: contract.service_id,
          description: contract.description ?? "",
          amountCents: contract.amount_cents,
          paymentMethod: contract.payment_method,
          recurrence: contract.recurrence,
          startDate: contract.start_date,
          endDate: contract.end_date,
          dueDay: contract.due_day,
          status: contract.status,
          notes: contract.notes ?? "",
          ownerId: null,
        }
      : emptyContract(),
  );

  function submit() {
    setError(null);
    const parsed = contractFormSchema.safeParse(value);
    if (!parsed.success) {
      setErrors(issuesToMap(parsed.error.issues));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = contract ? await updateContract({ ...value, id: contract.id }) : await createContract({ ...value, clientId });
      if (!res.ok) return void setError(res.message);
      toast.success(res.message);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{contract ? "Editar contrato" : "Novo contrato"}</DialogTitle>
          <DialogDescription>Mudanças em valores, datas e situação ficam registradas na auditoria.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormAlert>{error}</FormAlert>
          <ContractFields value={value} onChange={setValue} services={services} errors={errors} owners={contract ? owners : undefined} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {contract ? "Salvar contrato" : "Criar contrato"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
