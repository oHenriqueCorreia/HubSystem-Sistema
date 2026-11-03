"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, ExternalLink, LoaderCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormAlert, FormField } from "@/components/app/form-field";
import { Skeleton } from "@/components/ui/skeleton";
import { CHARGE_REASON_LABEL } from "@/domain/finance/charge";
import { formatBRL } from "@/domain/shared/money";
import { formatDate, formatDateTime } from "@/domain/shared/dates";
import { whatsappLink } from "@/domain/shared/phone";
import { getTransferOptions, getTxnHistory, prepareCharge, sendCharge, transferTransaction } from "../ops-actions";
import { KIND_LABEL, SCOPE_LABEL, STATUS_LABEL, type Account, type Category, type FinanceScope, type Transaction } from "../types";

const NONE = "__nenhuma__";

/** Mostra o que será movido antes de confirmar. Categoria e conta precisam ser as da área de destino. */
export function TransferDialog({ txn, scope, onClose, categoryName, accountName }: { txn: Transaction; scope: FinanceScope; onClose: () => void; categoryName?: string; accountName?: string }) {
  const router = useRouter();
  const to: FinanceScope = scope === "empresa" ? "pessoal" : "empresa";
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState(NONE);
  const [accountId, setAccountId] = useState(NONE);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const blocked = txn.contract_id ? "Este lançamento vem de um contrato: altere o contrato em vez de transferir." : txn.recurrence_id ? "Este lançamento vem de uma recorrência: encerre a recorrência e crie na área certa." : null;
  const needsAccount = txn.status === "pago";

  useEffect(() => {
    let alive = true;
    void getTransferOptions({ to }).then((res) => {
      if (!alive) return;
      if (!res.ok) return setError(res.message);
      setAccounts(res.data.accounts);
      setCategories(res.data.categories.filter((c) => c.kind === txn.kind));
      setAccountId(res.data.accounts[0]?.id ?? NONE);
    });
    return () => {
      alive = false;
    };
  }, [to, txn.kind]);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await transferTransaction({ id: txn.id, categoryId: categoryId === NONE ? null : categoryId, accountId: accountId === NONE ? null : accountId });
      if (!res.ok) return setError(res.message);
      toast.success(res.message);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {SCOPE_LABEL[scope]} <ArrowRight className="size-4" aria-hidden="true" /> {SCOPE_LABEL[to]}
          </DialogTitle>
          <DialogDescription>Confira o que será movido. Dados, anexos e histórico vão junto, sem criar outro lançamento.</DialogDescription>
        </DialogHeader>
        <FormAlert>{error ?? blocked}</FormAlert>
        <dl className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">Lançamento</dt>
            <dd className="font-medium break-words">{txn.description}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Valor</dt>
            <dd className="tabular">{formatBRL(txn.amount_cents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Tipo e situação</dt>
            <dd>
              {KIND_LABEL[txn.kind]}, {STATUS_LABEL[txn.status]}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Categoria atual</dt>
            <dd className="break-words">{categoryName ?? "Sem categoria"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Conta atual</dt>
            <dd className="break-words">{accountName ?? "Sem conta"}</dd>
          </div>
          {to === "pessoal" && (txn.client_id || txn.cost_center_id) && (
            <p className="col-span-2 text-xs text-muted-foreground">Cliente e centro de custo são só da empresa: o nome do cliente fica no lançamento e o restante fica registrado no histórico.</p>
          )}
        </dl>
        {accounts === null && !error ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div className="grid gap-3">
            <FormField label={`Categoria em ${SCOPE_LABEL[to]}`} optional>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem categoria</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label={`Conta em ${SCOPE_LABEL[to]}`} required={needsAccount} optional={!needsAccount} hint={needsAccount ? "O valor já pago entra no saldo desta conta." : undefined}>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!needsAccount && <SelectItem value={NONE}>Sem conta</SelectItem>}
                  {(accounts ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={confirm} disabled={pending || Boolean(blocked) || accounts === null || (needsAccount && accountId === NONE)}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Transferir para {SCOPE_LABEL[to]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ACTION_LABEL: Record<string, string> = { correcao: "Correção", transferencia: "Transferência", exclusao: "Exclusão", restauracao: "Restauração", cancelamento: "Cancelamento", baixa: "Baixa", reabertura: "Reabertura", conciliacao: "Conciliação" };
const FIELD_LABEL: Record<string, string> = { description: "Descrição", amount_cents: "Valor", paid_amount_cents: "Valor pago", paid_at: "Pagamento", status: "Situação", due_date: "Vencimento", competence_date: "Competência", account_id: "Conta", category_id: "Categoria", counterparty: "Cliente ou fornecedor", charge_reason: "Motivo", reconciled_at: "Conciliação", deleted_at: "Exclusão" };

function fieldValue(field: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "vazio";
  if (field.endsWith("cents")) return formatBRL(Number(value));
  if (field === "status") return STATUS_LABEL[value as Transaction["status"]] ?? String(value);
  if (field === "charge_reason") return CHARGE_REASON_LABEL[String(value)] ?? String(value);
  if (field === "account_id" || field === "category_id") return "alterada";
  if (field === "reconciled_at" || field === "deleted_at") return formatDateTime(String(value));
  if (field.endsWith("_at") || field.endsWith("_date")) return formatDate(String(value));
  return String(value);
}

type History = Awaited<ReturnType<typeof getTxnHistory>>;

export function HistoryDialog({ txn, onClose }: { txn: Transaction; onClose: () => void }) {
  const [data, setData] = useState<History | null>(null);
  useEffect(() => {
    let alive = true;
    void getTxnHistory({ id: txn.id }).then((res) => alive && setData(res));
    return () => {
      alive = false;
    };
  }, [txn.id]);
  const h = data?.ok ? data.data : null;
  const who = (id: string | null) => (id && h?.names[id]) || "Sistema";
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Histórico</DialogTitle>
          <DialogDescription className="break-words">{txn.description}</DialogDescription>
        </DialogHeader>
        {!data && <Skeleton className="h-24 w-full" />}
        {data && !data.ok && <FormAlert>{data.message}</FormAlert>}
        {h && (
          <div className="grid gap-4 text-sm">
            {h.transfers.map((t) => (
              <div key={t.id} className="rounded-lg border bg-muted/30 p-2">
                <p className="font-medium">
                  {SCOPE_LABEL[t.from_scope as FinanceScope]} para {SCOPE_LABEL[t.to_scope as FinanceScope]}
                </p>
                <p className="text-xs text-muted-foreground">
                  {who(t.moved_by)} em {formatDateTime(t.moved_at)}
                </p>
                <p className="text-xs break-words">Antes: {[t.previous_category && `categoria ${t.previous_category}`, t.previous_account && `conta ${t.previous_account}`, t.previous_client && `cliente ${t.previous_client}`, t.previous_cost_center && `centro de custo ${t.previous_cost_center}`].filter(Boolean).join(", ") || "sem classificação"}.</p>
              </div>
            ))}
            {h.charges.length > 0 && (
              <section aria-label="Cobranças enviadas" className="grid gap-1">
                <h3 className="font-semibold">Cobranças</h3>
                {h.charges.map((c) => (
                  <p key={c.id} className="text-xs break-words">
                    <span className={c.status === "erro" ? "text-danger" : ""}>{c.status === "enviada" ? "Enviada" : `Erro: ${c.error ?? "falha"}`}</span> para {c.phone}, por {who(c.sent_by)} em {formatDateTime(c.created_at)}
                  </p>
                ))}
              </section>
            )}
            {h.events.length === 0 && h.transfers.length === 0 ? (
              <p className="text-muted-foreground">Nenhuma alteração registrada.</p>
            ) : (
              <ol className="grid gap-2">
                {h.events.map((e) => (
                  <li key={e.id} className="border-t pt-2 first:border-0 first:pt-0">
                    <p className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</p>
                    <p className="text-xs text-muted-foreground">
                      {who(e.actor_id)} em {formatDateTime(e.created_at)}
                    </p>
                    <ul className="text-xs break-words">
                      {Object.entries(e.changes).map(([k, v]) => (
                        <li key={k}>
                          {FIELD_LABEL[k] ?? k}: {fieldValue(k, v.de)} para {fieldValue(k, v.para)}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ChargeDialog({ txn, scope, onClose }: { txn: Transaction; scope: FinanceScope; onClose: () => void }) {
  const router = useRouter();
  const [state, setState] = useState<{ phone: string; message: string; hasProfile: boolean; whatsappReady: boolean; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    void prepareCharge({ id: txn.id }).then((res) => {
      if (!alive) return;
      if (res.ok) setState(res.data);
      else setError(res.message);
    });
    return () => {
      alive = false;
    };
  }, [txn.id]);

  function send() {
    if (!state) return;
    setError(null);
    startTransition(async () => {
      const res = await sendCharge({ id: txn.id, phone: state.phone, body: state.message });
      if (!res.ok) {
        router.refresh();
        return setError(res.fieldErrors?.phone?.[0] ?? res.fieldErrors?.body?.[0] ?? res.message);
      }
      toast.success(res.message);
      onClose();
      router.refresh();
    });
  }

  const digits = state?.phone.replace(/\D/g, "") ?? "";
  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cobrar por WhatsApp</DialogTitle>
          <DialogDescription>Revise e edite o texto antes de enviar. O envio fica registrado no histórico do lançamento.</DialogDescription>
        </DialogHeader>
        <FormAlert>{error}</FormAlert>
        {!state && !error && <Skeleton className="h-40 w-full" />}
        {state && (
          <div className="grid gap-3">
            {!state.hasProfile && (
              <p className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning-soft p-2 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" /> Cadastre os dados de recebimento {scope === "empresa" ? "da empresa" : "pessoais"} em Contas e categorias para o Pix entrar na mensagem.
              </p>
            )}
            <FormField label="Telefone" required>
              <Input type="tel" inputMode="tel" value={state.phone} onChange={(e) => setState({ ...state, phone: e.target.value })} autoComplete="off" placeholder="(48) 99999-0000…" />
            </FormField>
            <FormField label="Mensagem" required>
              <Textarea rows={11} value={state.message} maxLength={4000} onChange={(e) => setState({ ...state, message: e.target.value })} />
            </FormField>
          </div>
        )}
        <DialogFooter className="flex-wrap">
          {state && digits.length >= 10 && (
            <Button asChild variant="ghost">
              <a href={whatsappLink(state.phone.startsWith("+") ? state.phone : `+${digits.length <= 11 ? `55${digits}` : digits}`, state.message)} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden="true" /> Abrir no meu WhatsApp
              </a>
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Fechar
          </Button>
          <Button onClick={send} disabled={pending || !state || !state.phone || !state.message.trim() || !state.whatsappReady} title={state && !state.whatsappReady ? "Nenhum WhatsApp conectado" : undefined}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />} Enviar cobrança
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
