"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { moveDeal } from "@/features/crm/actions";
import { saveContact } from "../actions";
import type { PanelDeal } from "./lead-side-panel";

export type ContactLead = { id: string; name: string; company_name?: string | null; email?: string | null; notes?: string | null };

const SAVE_AFTER_MS = 700;
const validEmail = (v: string) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/**
 * Ficha do contato dentro da conversa. Salva sozinho: o que muda aqui é o próprio lead,
 * então vale no funil, nos leads e nas conversas dele na hora.
 */
export function ContactCard({ conversationId, name, lead, deals, canEdit, canEditLead, canMove }: { conversationId: string; name: string; lead: ContactLead | null; deals: PanelDeal[]; canEdit: boolean; canEditLead: boolean; canMove: boolean }) {
  const router = useRouter();
  const initial = { name: lead?.name || name, company: lead?.company_name ?? "", email: lead?.email ?? "", notes: lead?.notes ?? "" };
  const [form, setForm] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const saved = useRef(JSON.stringify(initial));
  const latest = useRef(form);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leadLocked = Boolean(lead) && !canEditLead;
  const locked = !canEdit || leadLocked;

  // Um salvamento por vez: o que mudar enquanto salva entra logo em seguida.
  async function flush() {
    if (timer.current) clearTimeout(timer.current);
    if (busy.current || locked) return;
    const current = latest.current;
    const snapshot = JSON.stringify(current);
    if (snapshot === saved.current) return;
    if (current.name.trim().length < 2) return setError("Informe o nome.");
    if (!validEmail(current.email.trim())) return setError("Confira o e-mail.");
    setError(null);
    busy.current = true;
    setState("saving");
    const res = await saveContact({ conversationId, ...current, email: current.email.trim() }).catch(() => null);
    busy.current = false;
    if (!res?.ok) {
      setState("error");
      setError(res ? (Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message ?? "Não foi possível salvar.") : "Sem conexão. Sua alteração não foi salva.");
      return;
    }
    saved.current = snapshot;
    setState("saved");
    router.refresh();
    if (JSON.stringify(latest.current) !== snapshot) void flush();
  }

  function change(patch: Partial<typeof form>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setForm(next);
    setState("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
  }

  // Fechar o painel logo depois de digitar não perde o que foi escrito.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void flush();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao sair da tela
    [],
  );

  function move(dealId: string, stageId: string) {
    startTransition(async () => {
      const res = await moveDeal({ dealId, stageId, position: Date.now() / 1000 });
      if (res.ok) toast.success("Etapa do funil atualizada.");
      else toast.error(res.message);
      router.refresh();
    });
  }

  const blur = () => void flush();

  return (
    <div className="grid gap-4">
      <form onSubmit={(e) => e.preventDefault()} className="grid gap-3" aria-label="Dados do contato">
        <div className="grid gap-1.5">
          <Label htmlFor="contato-nome">Nome</Label>
          <Input id="contato-nome" name="nome" autoComplete="off" maxLength={120} disabled={locked} aria-invalid={error === "Informe o nome." || undefined} value={form.name} onBlur={blur} onChange={(e) => change({ name: e.target.value })} />
        </div>
        {lead && (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="contato-empresa">Empresa</Label>
              <Input id="contato-empresa" name="empresa" autoComplete="off" maxLength={160} disabled={locked} value={form.company} onBlur={blur} onChange={(e) => change({ company: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="contato-email">E-mail</Label>
              <Input id="contato-email" name="email" type="email" inputMode="email" autoComplete="off" spellCheck={false} disabled={locked} aria-invalid={error === "Confira o e-mail." || undefined} value={form.email} onBlur={blur} onChange={(e) => change({ email: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="contato-notas">Observações</Label>
              <Textarea id="contato-notas" name="observacoes" rows={3} maxLength={2000} disabled={locked} value={form.notes} onBlur={blur} onChange={(e) => change({ notes: e.target.value })} />
            </div>
          </>
        )}
        <p className="flex min-h-5 items-center gap-1.5 text-xs" aria-live="polite">
          {error ? (
            <span className="text-danger">{error}</span>
          ) : state === "saving" ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> Salvando…
            </span>
          ) : state === "saved" ? (
            <span className="flex items-center gap-1.5 text-success">
              <Check className="size-3.5" aria-hidden="true" /> Salvo{lead ? " no contato e no lead" : ""}
            </span>
          ) : locked ? (
            <span className="text-muted-foreground">Você não pode editar este contato.</span>
          ) : (
            <span className="text-muted-foreground">Salva sozinho enquanto você edita.</span>
          )}
        </p>
      </form>
      {deals.map((d) => (
        <div key={d.id} className="grid gap-1.5">
          <Label htmlFor={`contato-etapa-${d.id}`}>Etapa em {d.pipeline_name}</Label>
          <Select value={d.stage_id} disabled={!canMove || pending} onValueChange={(stageId) => move(d.id, stageId)}>
            <SelectTrigger id={`contato-etapa-${d.id}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* Marcar como perdido pede o motivo: isso fica na tela do funil. */}
              {d.stages
                .filter((s) => s.kind !== "lost" || s.id === d.stage_id)
                .map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}
