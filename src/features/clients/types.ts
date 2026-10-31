export type ContractStatus = "rascunho" | "ativo" | "pausado" | "encerrado" | "cancelado";
export type Recurrence = "unica" | "mensal" | "trimestral" | "semestral" | "anual";
export type PaymentMethod = "pix" | "boleto" | "cartao_credito" | "cartao_debito" | "transferencia" | "dinheiro" | "outro";

export type Service = { id: string; name: string; kind: string; is_recurring: boolean; default_price_cents: number | null; is_active: boolean };

export type ClientRow = {
  id: string;
  lead_id: string;
  legal_name: string | null;
  document: string | null;
  billing_email: string | null;
  billing_phone_e164: string | null;
  owner_id: string | null;
  status: "ativo" | "inativo";
  notes: string | null;
  converted_at: string;
  lead: { id: string; name: string; city: string | null; state: string | null; phone_e164: string | null; whatsapp_e164: string | null; email: string | null };
  contracts: { id: string; amount_cents: number; recurrence: Recurrence; status: ContractStatus }[];
};

export type Contract = {
  id: string;
  client_id: string;
  service_id: string | null;
  deal_id: string | null;
  owner_id: string | null;
  title: string;
  description: string | null;
  amount_cents: number;
  payment_method: PaymentMethod;
  recurrence: Recurrence;
  start_date: string;
  end_date: string | null;
  due_day: number | null;
  status: ContractStatus;
  notes: string | null;
  created_at: string;
  client: { id: string; legal_name: string | null; lead: { id: string; name: string } | null } | null;
  service: { id: string; name: string } | null;
};

export type Attachment = { id: string; file_name: string; mime_type: string; size_bytes: number; created_at: string; uploaded_by: string | null; storage_path: string };

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  rascunho: "Rascunho",
  ativo: "Ativo",
  pausado: "Pausado",
  encerrado: "Encerrado",
  cancelado: "Cancelado",
};
export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  unica: "Pagamento único",
  mensal: "Mensal",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
};
export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  pix: "Pix",
  boleto: "Boleto",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  transferencia: "Transferência",
  dinheiro: "Dinheiro",
  outro: "Outro",
};

/** Receita recorrente mensal equivalente de um contrato ativo (centavos). */
export function monthlyValue(c: { amount_cents: number; recurrence: Recurrence; status: ContractStatus }): number {
  if (c.status !== "ativo") return 0;
  const div = { unica: 0, mensal: 1, trimestral: 3, semestral: 6, anual: 12 }[c.recurrence];
  return div ? Math.round(c.amount_cents / div) : 0;
}

export const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;
export const ATTACHMENT_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "image/webp": "WEBP",
  "image/heic": "HEIC",
  "application/msword": "DOC",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.ms-excel": "XLS",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "text/csv": "CSV",
  "text/plain": "TXT",
};
