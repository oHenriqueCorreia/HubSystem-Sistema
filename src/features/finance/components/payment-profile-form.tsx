"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormAlert, FormField } from "@/components/app/form-field";
import { PIX_KEY_TYPE_LABEL, type PaymentProfile } from "@/domain/finance/charge";
import { savePaymentProfile } from "../ops-actions";
import type { FinanceScope } from "../types";

export function PaymentProfileForm({ scope, profile, canEdit }: { scope: FinanceScope; profile: PaymentProfile | null; canEdit: boolean }) {
  const router = useRouter();
  const [pixKey, setPixKey] = useState(profile?.pix_key ?? "");
  const [pixKeyType, setType] = useState(profile?.pix_key_type ?? (scope === "empresa" ? "cnpj" : "cpf"));
  const [holderName, setHolder] = useState(profile?.holder_name ?? "");
  const [bankName, setBank] = useState(profile?.bank_name ?? "");
  const [instructions, setInstructions] = useState(profile?.instructions ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section aria-labelledby="dados-recebimento" className="grid gap-3">
      <div>
        <h2 id="dados-recebimento" className="text-lg font-semibold">
          Dados de recebimento {scope === "empresa" ? "da empresa" : "pessoais"}
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">Entram nas cobranças {scope === "empresa" ? "da empresa" : "do seu financeiro pessoal"}. {scope === "pessoal" ? "Só você vê estes dados." : "Cobranças pessoais usam outro cadastro."}</p>
      </div>
      <form
        className="grid max-w-2xl gap-3 sm:grid-cols-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const res = await savePaymentProfile({ scope, pixKey, pixKeyType, holderName, bankName, instructions });
            if (!res.ok) return setError(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message);
            toast.success(res.message);
            router.refresh();
          });
        }}
      >
        <div className="sm:col-span-2">
          <FormAlert>{error}</FormAlert>
        </div>
        <FormField label="Tipo da chave">
          <Select value={pixKeyType} disabled={!canEdit} onValueChange={setType}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PIX_KEY_TYPE_LABEL).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Chave Pix" required>
          <Input value={pixKey} disabled={!canEdit} maxLength={140} spellCheck={false} autoComplete="off" onChange={(e) => setPixKey(e.target.value)} />
        </FormField>
        <FormField label="Favorecido" required>
          <Input value={holderName} disabled={!canEdit} maxLength={160} autoComplete="off" onChange={(e) => setHolder(e.target.value)} />
        </FormField>
        <FormField label="Banco" optional>
          <Input value={bankName} disabled={!canEdit} maxLength={80} autoComplete="off" onChange={(e) => setBank(e.target.value)} />
        </FormField>
        <FormField label="Instruções" optional className="sm:col-span-2">
          <Textarea rows={2} value={instructions} disabled={!canEdit} maxLength={500} onChange={(e) => setInstructions(e.target.value)} />
        </FormField>
        {canEdit && (
          <Button type="submit" variant="outline" className="justify-self-start" disabled={pending || !pixKey.trim() || !holderName.trim()}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar dados de recebimento
          </Button>
        )}
      </form>
    </section>
  );
}
