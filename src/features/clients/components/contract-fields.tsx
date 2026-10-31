"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/app/form-field";
import { MoneyInput } from "@/components/app/money-input";
import { todayLocal } from "@/domain/shared/dates";
import { CONTRACT_STATUS_LABEL, PAYMENT_LABEL, RECURRENCE_LABEL, type Service } from "../types";
import type { ContractFormValues } from "../schemas";

const NONE = "__nenhum__";

export function emptyContract(service?: Service): ContractFormValues {
  return {
    title: service?.name ?? "",
    serviceId: service?.id ?? null,
    description: "",
    amountCents: service?.default_price_cents ?? (null as unknown as number),
    paymentMethod: "pix",
    recurrence: service?.is_recurring ? "mensal" : "unica",
    startDate: todayLocal(),
    endDate: null,
    dueDay: null,
    status: "ativo",
    notes: "",
  };
}

/** Campos do contrato (controlados), reaproveitados no cadastro e na conversão. */
export function ContractFields({
  value,
  onChange,
  services,
  errors,
  owners,
  showStatus = true,
}: {
  value: ContractFormValues;
  onChange: (v: ContractFormValues) => void;
  services: Service[];
  errors: Record<string, string>;
  owners?: { id: string; full_name: string; email: string }[];
  showStatus?: boolean;
}) {
  const set = <K extends keyof ContractFormValues>(k: K, v: ContractFormValues[K]) => onChange({ ...value, [k]: v });

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label="Serviço" className="sm:col-span-2">
        <Select
          value={value.serviceId ?? NONE}
          onValueChange={(id) => {
            const s = services.find((x) => x.id === id);
            onChange({
              ...value,
              serviceId: id === NONE ? null : id,
              title: value.title || s?.name || "",
              recurrence: s ? (s.is_recurring ? "mensal" : "unica") : value.recurrence,
              amountCents: value.amountCents ?? s?.default_price_cents ?? value.amountCents,
            });
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Sem serviço específico</SelectItem>
            {services
              .filter((s) => s.is_active)
              .map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Título do contrato" error={errors.title} required className="sm:col-span-2">
        <Input value={value.title} onChange={(e) => set("title", e.target.value)} placeholder="Ex.: Site institucional — Vidraçaria Sol" />
      </FormField>
      <FormField label="Valor" error={errors.amountCents} required>
        <MoneyInput value={value.amountCents} onChange={(c) => set("amountCents", c as number)} />
      </FormField>
      <FormField label="Recorrência">
        <Select value={value.recurrence} onValueChange={(v) => set("recurrence", v as ContractFormValues["recurrence"])}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(RECURRENCE_LABEL).map(([k, l]) => (
              <SelectItem key={k} value={k}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Forma de pagamento">
        <Select value={value.paymentMethod} onValueChange={(v) => set("paymentMethod", v as ContractFormValues["paymentMethod"])}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PAYMENT_LABEL).map(([k, l]) => (
              <SelectItem key={k} value={k}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Dia de vencimento" hint="Para contratos recorrentes." error={errors.dueDay} optional>
        <Input type="number" min={1} max={31} value={value.dueDay ?? ""} onChange={(e) => set("dueDay", e.target.value ? Number(e.target.value) : null)} />
      </FormField>
      <FormField label="Início" error={errors.startDate} required>
        <Input type="date" value={value.startDate} onChange={(e) => set("startDate", e.target.value)} />
      </FormField>
      <FormField label="Término" error={errors.endDate} optional>
        <Input type="date" value={value.endDate ?? ""} onChange={(e) => set("endDate", e.target.value || null)} />
      </FormField>
      {showStatus && (
        <FormField label="Situação">
          <Select value={value.status ?? "ativo"} onValueChange={(v) => set("status", v as ContractFormValues["status"])}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CONTRACT_STATUS_LABEL).map(([k, l]) => (
                <SelectItem key={k} value={k}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
      {owners && owners.length > 0 && (
        <FormField label="Responsável">
          <Select value={value.ownerId ?? NONE} onValueChange={(v) => set("ownerId", v === NONE ? null : v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Manter atual</SelectItem>
              {owners.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.full_name || o.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
      <FormField label="Descrição / escopo" optional className="sm:col-span-2">
        <Textarea rows={3} value={value.description ?? ""} onChange={(e) => set("description", e.target.value)} />
      </FormField>
      <FormField label="Observações" optional className="sm:col-span-2">
        <Textarea rows={2} value={value.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
      </FormField>
    </div>
  );
}

export function issuesToMap(issues: { path: PropertyKey[]; message: string }[], prefix = "") {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const path = i.path.map(String);
    const key = prefix && path[0] === prefix ? path.slice(1).join(".") : path.join(".");
    out[key] ??= i.message;
  }
  return out;
}
