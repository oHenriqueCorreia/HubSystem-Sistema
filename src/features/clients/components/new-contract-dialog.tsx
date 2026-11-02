"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormAlert, FormField } from "@/components/app/form-field";
import { createClient } from "@/lib/supabase/client";
import { createContractWithClient, registerAttachment, requestUpload } from "../actions";
import { contractFormSchema, type ContractFormValues } from "../schemas";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES, type Service } from "../types";
import { ContractFields, emptyContract, issuesToMap } from "./contract-fields";

const NONE = "__nenhum__";
type Option = { id: string; name: string };
type FinanceLookups = { accounts: { id: string; name: string; is_active: boolean }[]; categories: { id: string; name: string; kind: string; is_active: boolean }[] };

/**
 * Novo contrato pela tela de Contratos: cliente (existente, lead do CRM ou
 * novo), dados do contrato, arquivo assinado e lançamento das mensalidades
 * como receitas recorrentes no financeiro da empresa.
 */
export function NewContractDialog({
  clients,
  leads,
  services,
  finance,
  canCreateClient,
}: {
  clients: Option[];
  leads: Option[];
  services: Service[];
  /** Presente quando o usuário pode lançar no financeiro da empresa. */
  finance: FinanceLookups | null;
  canCreateClient: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"cliente" | "lead" | "novo">(clients.length ? "cliente" : canCreateClient ? "novo" : "cliente");
  const [clientId, setClientId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [novo, setNovo] = useState({ name: "", document: "", email: "", phone: "" });
  const [contract, setContract] = useState<ContractFormValues>(() => ({ ...emptyContract(), recurrence: "mensal", dueDay: 10 }));
  const [launch, setLaunch] = useState(Boolean(finance));
  const [accountId, setAccountId] = useState(finance?.accounts.find((a) => a.is_active)?.id ?? NONE);
  const [categoryId, setCategoryId] = useState(NONE);
  const [past, setPast] = useState<"ignorar" | "recebidas" | "abertas">("ignorar");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const incomeCategories = finance?.categories.filter((c) => c.kind === "receita" && c.is_active) ?? [];

  function client() {
    if (mode === "cliente") return { mode, clientId };
    if (mode === "lead") return { mode, leadId };
    return { mode, ...novo };
  }

  function submit() {
    setError(null);
    const parsed = contractFormSchema.safeParse(contract);
    const fieldErrors: Record<string, string> = parsed.success ? {} : issuesToMap(parsed.error.issues);
    if (mode === "cliente" && !clientId) fieldErrors.clientId = "Escolha o cliente.";
    if (mode === "lead" && !leadId) fieldErrors.leadId = "Escolha o lead.";
    if (mode === "novo" && novo.name.trim().length < 2) fieldErrors.name = "Informe o nome do cliente.";
    if (file && (!ATTACHMENT_TYPES[file.type] || file.size > ATTACHMENT_MAX_BYTES)) fieldErrors.file = "Use PDF, imagem ou Word de até 15 MB.";
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) return;

    startTransition(async () => {
      const res = await createContractWithClient({
        client: client() as never,
        contract,
        finance: { launch: launch && Boolean(finance), accountId: accountId === NONE ? null : accountId, categoryId: categoryId === NONE ? null : categoryId, past },
      });
      if (!res.ok) {
        if (res.fieldErrors) setErrors(Object.fromEntries(Object.entries(res.fieldErrors).map(([k, v]) => [k.split(".").pop()!, v[0]])));
        return void setError(res.message);
      }
      // Arquivo do contrato: enviado depois que o contrato existe (o caminho leva o id dele).
      if (file) {
        const req = await requestUpload({ entityType: "contract", entityId: res.data.id, fileName: file.name, mimeType: file.type, size: file.size });
        const uploaded = req.ok && !(await createClient().storage.from("attachments").uploadToSignedUrl(req.data.path, req.data.token, file, { contentType: file.type })).error;
        if (req.ok && uploaded) await registerAttachment({ entityType: "contract", entityId: res.data.id, fileName: file.name, mimeType: file.type, size: file.size, path: req.data.path });
        else toast.error("O contrato foi criado, mas o arquivo não foi enviado. Anexe de novo na página do contrato.");
      }
      toast.success(res.message);
      setOpen(false);
      router.push(`/contratos/${res.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>
        <Button>
          <FilePlus2 aria-hidden="true" /> Novo contrato
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo contrato</DialogTitle>
          <DialogDescription>Escolha o cliente, preencha a mensalidade e anexe o contrato. As mensalidades entram como receitas recorrentes no financeiro da empresa.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <FormAlert>{error}</FormAlert>

          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-semibold">Cliente</legend>
            <ToggleGroup type="single" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as typeof mode)} aria-label="De onde vem o cliente" className="justify-self-start">
              <ToggleGroupItem value="cliente" disabled={!clients.length}>
                Cliente cadastrado
              </ToggleGroupItem>
              {canCreateClient && <ToggleGroupItem value="lead">Lead do CRM</ToggleGroupItem>}
              {canCreateClient && <ToggleGroupItem value="novo">Cliente novo</ToggleGroupItem>}
            </ToggleGroup>
            {mode === "cliente" && (
              <FormField label="Cliente" error={errors.clientId} required>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Escolha o cliente…" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
            {mode === "lead" && (
              <FormField label="Lead" hint="O lead vira cliente e o negócio dele fica vinculado." error={errors.leadId} required>
                <Select value={leadId} onValueChange={setLeadId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={leads.length ? "Escolha o lead…" : "Nenhum lead disponível"} />
                  </SelectTrigger>
                  <SelectContent>
                    {leads.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
            {mode === "novo" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Nome ou razão social" error={errors.name} required className="sm:col-span-2">
                  <Input value={novo.name} onChange={(e) => setNovo({ ...novo, name: e.target.value })} maxLength={160} autoComplete="organization" placeholder="Ex.: Mattos Pneus LTDA…" />
                </FormField>
                <FormField label="CPF ou CNPJ" error={errors.document} optional>
                  <Input value={novo.document} onChange={(e) => setNovo({ ...novo, document: e.target.value })} inputMode="numeric" autoComplete="off" spellCheck={false} placeholder="00.000.000/0001-00…" />
                </FormField>
                <FormField label="Telefone" error={errors.phone} optional>
                  <Input value={novo.phone} onChange={(e) => setNovo({ ...novo, phone: e.target.value })} type="tel" inputMode="tel" autoComplete="tel" placeholder="(48) 99999-0000…" />
                </FormField>
                <FormField label="E-mail de cobrança" error={errors.email} optional className="sm:col-span-2">
                  <Input value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} type="email" autoComplete="email" spellCheck={false} placeholder="financeiro@cliente.com.br…" />
                </FormField>
              </div>
            )}
          </fieldset>

          <fieldset className="grid gap-3 border-t pt-4">
            <legend className="mb-1 text-sm font-semibold">Contrato</legend>
            <ContractFields value={contract} onChange={setContract} services={services} errors={errors} />
          </fieldset>

          <fieldset className="grid gap-2 border-t pt-4">
            <legend className="mb-1 text-sm font-semibold">Arquivo do contrato</legend>
            <FormField label="PDF, imagem ou Word (até 15 MB)" error={errors.file} optional>
              <Input type="file" accept={Object.keys(ATTACHMENT_TYPES).join(",")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </FormField>
          </fieldset>

          {finance && (
            <fieldset className="grid gap-3 border-t pt-4">
              <legend className="mb-1 text-sm font-semibold">Financeiro da empresa</legend>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={launch} onCheckedChange={(v) => setLaunch(Boolean(v))} className="mt-0.5" />
                <span>
                  Lançar as mensalidades como receitas recorrentes
                  <span className="block text-xs text-muted-foreground">Ligadas a este cliente e contrato. Mudanças no contrato (valor, pausa, cancelamento) atualizam as próximas cobranças.</span>
                </span>
              </label>
              {launch && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Conta de recebimento" optional>
                    <Select value={accountId} onValueChange={setAccountId}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Definir depois</SelectItem>
                        {finance.accounts
                          .filter((a) => a.is_active)
                          .map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField label="Categoria de receita" optional>
                    <Select value={categoryId} onValueChange={setCategoryId}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Sem categoria</SelectItem>
                        {incomeCategories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField label="Mensalidades com vencimento antes de hoje" hint="Para contratos que já estavam em andamento." className="sm:col-span-2">
                    <Select value={past} onValueChange={(v) => setPast(v as typeof past)}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ignorar">Não lançar (começa no próximo vencimento)</SelectItem>
                        <SelectItem value="recebidas">Lançar como já recebidas</SelectItem>
                        <SelectItem value="abertas">Lançar em aberto (cobrar)</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormField>
                </div>
              )}
            </fieldset>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Criar contrato
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
