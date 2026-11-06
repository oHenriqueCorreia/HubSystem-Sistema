"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormAlert, FormField } from "@/components/app/form-field";
import { formatDocument } from "@/domain/shared/document";
import { formatPhone } from "@/domain/shared/phone";
import { updateClient } from "../actions";
import { clientUpdateSchema } from "../schemas";
import type { ClientRow } from "../types";
import { issuesToMap } from "./contract-fields";

export function ClientEditDialog({ client }: { client: ClientRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [v, setV] = useState({
    legalName: client.legal_name ?? "",
    document: formatDocument(client.document),
    billingEmail: client.billing_email ?? "",
    billingPhone: formatPhone(client.billing_phone_e164),
    status: client.status,
    notes: client.notes ?? "",
  });

  function submit() {
    const payload = { ...v, id: client.id };
    const parsed = clientUpdateSchema.safeParse(payload);
    if (!parsed.success) return setErrors(issuesToMap(parsed.error.issues));
    setErrors({});
    startTransition(async () => {
      const res = await updateClient(payload);
      if (!res.ok) return void setError(res.message);
      toast.success(res.message);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Pencil aria-hidden="true" /> Editar cliente
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dados do cliente</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <FormAlert>{error}</FormAlert>
          <FormField label="Razão social / nome completo" optional>
            <Input value={v.legalName} onChange={(e) => setV({ ...v, legalName: e.target.value })} />
          </FormField>
          {/* Sem clients.billing os dados não chegam aqui; os campos somem e o servidor não os grava. */}
          {!client.billing_hidden && (
            <>
              <FormField label="CPF ou CNPJ" error={errors.document} optional>
                <Input inputMode="numeric" value={v.document} onChange={(e) => setV({ ...v, document: e.target.value })} />
              </FormField>
              <FormField label="E-mail de cobrança" error={errors.billingEmail} optional>
                <Input type="email" spellCheck={false} value={v.billingEmail} onChange={(e) => setV({ ...v, billingEmail: e.target.value })} />
              </FormField>
              <FormField label="Telefone de cobrança" error={errors.billingPhone} optional>
                <Input type="tel" value={v.billingPhone} onChange={(e) => setV({ ...v, billingPhone: e.target.value })} />
              </FormField>
            </>
          )}
          <FormField label="Situação">
            <Select value={v.status} onValueChange={(s) => setV({ ...v, status: s as "ativo" | "inativo" })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ativo">Ativo</SelectItem>
                <SelectItem value="inativo">Inativo</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Observações" optional>
            <Textarea rows={3} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
