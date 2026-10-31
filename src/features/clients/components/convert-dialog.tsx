"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormAlert, FormField } from "@/components/app/form-field";
import { convertLead } from "../actions";
import { convertSchema, type ContractFormValues } from "../schemas";
import type { Service } from "../types";
import { ContractFields, emptyContract, issuesToMap } from "./contract-fields";

export function ConvertDialog({
  lead,
  dealId,
  services,
  interest,
}: {
  lead: { id: string; name: string; email: string | null; phone: string | null };
  dealId: string | null;
  services: Service[];
  interest: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [legalName, setLegalName] = useState("");
  const [document, setDocument] = useState("");
  const [email, setEmail] = useState(lead.email ?? "");
  const [phone, setPhone] = useState(lead.phone ?? "");
  const [withContract, setWithContract] = useState(true);
  const suggested = services.find((s) => interest.includes(s.name)) ?? services.find((s) => s.kind === "site");
  const [contract, setContract] = useState<ContractFormValues>(() => ({ ...emptyContract(suggested), title: suggested ? `${suggested.name} — ${lead.name}` : "" }));

  function submit() {
    setError(null);
    const payload = { leadId: lead.id, dealId, legalName, document, billingEmail: email, billingPhone: phone, contract: withContract ? contract : null };
    const parsed = convertSchema.safeParse(payload);
    if (!parsed.success) {
      const map = issuesToMap(parsed.error.issues);
      const contractErrors = issuesToMap(parsed.error.issues.filter((i) => i.path[0] === "contract"), "contract");
      setErrors({ ...map, ...contractErrors });
      setError("Revise os campos destacados.");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await convertLead(payload);
      if (!res.ok) return void setError(res.message);
      toast.success(res.message);
      setOpen(false);
      router.push(`/clientes/${res.data.client_id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>
        <Button>
          <BadgeCheck aria-hidden="true" /> Converter em cliente
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Converter {lead.name} em cliente</DialogTitle>
          <DialogDescription>O negócio vai para “fechado”. Contatos, etiquetas e todo o histórico continuam no mesmo cadastro.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <FormAlert>{error}</FormAlert>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">Dados de cobrança</legend>
            <FormField label="Razão social / nome completo" optional className="sm:col-span-2">
              <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} />
            </FormField>
            <FormField label="CPF ou CNPJ" error={errors.document} optional>
              <Input inputMode="numeric" value={document} onChange={(e) => setDocument(e.target.value)} />
            </FormField>
            <FormField label="E-mail de cobrança" error={errors.billingEmail} optional>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </FormField>
            <FormField label="Telefone de cobrança" error={errors.billingPhone} optional>
              <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </FormField>
          </fieldset>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <Switch checked={withContract} onCheckedChange={setWithContract} /> Criar o contrato agora
          </label>
          {withContract && <ContractFields value={contract} onChange={setContract} services={services} errors={errors} showStatus={false} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Converter em cliente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
