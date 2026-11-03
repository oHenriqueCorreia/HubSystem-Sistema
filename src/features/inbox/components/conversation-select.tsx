"use client";

import { createContext, useContext, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ListChecks, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { excludeAllGroupsExcept, excludeConversations, restoreConversations } from "../actions";

type Mode = "excluir" | "restaurar";
type Selection = { selecting: boolean; always: boolean; ids: Set<string>; toggle: (id: string) => void; start: () => void; stop: () => void; setIds: (ids: Set<string>) => void };

const Ctx = createContext<Selection | null>(null);

/** `always`: lista em que a conversa não abre (Excluídas), então tocar sempre marca. */
export function SelectionProvider({ always = false, children }: { always?: boolean; children: ReactNode }) {
  const [on, setSelecting] = useState(false);
  const selecting = always || on;
  const [ids, setIds] = useState<Set<string>>(new Set());
  const value = useMemo<Selection>(
    () => ({
      selecting,
      always,
      ids,
      setIds,
      start: () => setSelecting(true),
      stop: () => {
        setSelecting(false);
        setIds(new Set());
      },
      toggle: (id) =>
        setIds((cur) => {
          const next = new Set(cur);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
    }),
    [selecting, always, ids],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function SelectToggle() {
  const s = useContext(Ctx)!;
  if (s.always) return null;
  return (
    <Button variant="ghost" size="icon-sm" aria-label={s.selecting ? "Cancelar seleção" : "Selecionar conversas"} title="Selecionar" aria-pressed={s.selecting} onClick={() => (s.selecting ? s.stop() : s.start())}>
      <ListChecks aria-hidden="true" />
    </Button>
  );
}

/** Em modo de seleção, tocar na conversa marca em vez de abrir. */
export function SelectRow({ id, name, children }: { id: string; name: string; children: ReactNode }) {
  const s = useContext(Ctx)!;
  if (!s.selecting) return <>{children}</>;
  return (
    <label className="flex cursor-pointer items-center pl-3 hover:bg-accent">
      <Checkbox checked={s.ids.has(id)} aria-label={`Selecionar ${name}`} onCheckedChange={() => s.toggle(id)} />
      <div inert className="min-w-0 flex-1">
        {children}
      </div>
    </label>
  );
}

export function SelectionBar({ allIds, mode, groupsTab, totalGroups, numberId }: { allIds: string[]; mode: Mode; groupsTab: boolean; totalGroups: number; numberId?: string }) {
  const s = useContext(Ctx)!;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (!s.selecting) return null;
  const count = s.ids.size;
  const all = allIds.length > 0 && allIds.every((id) => s.ids.has(id));
  const plural = (n: number) => (n === 1 ? "conversa" : "conversas");
  const others = totalGroups - count;

  const finish = (res: { ok: boolean; message?: string }) => {
    if (!res.ok) {
      toast.error(res.message);
      return false;
    }
    toast.success(res.message);
    s.stop();
    router.refresh();
  };

  return (
    <div role="region" aria-label="Ações nas conversas selecionadas" className="grid gap-2 border-t bg-[var(--chat-panel)] p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium" aria-live="polite">
          {count} {count === 1 ? "selecionada" : "selecionadas"}
        </p>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => s.setIds(new Set(all ? [] : allIds))}>
            {all ? "Desmarcar todas" : "Marcar todas"}
          </Button>
          {!s.always && (
            <Button variant="ghost" size="sm" onClick={s.stop}>
              Cancelar
            </Button>
          )}
        </div>
      </div>
      {mode === "restaurar" ? (
        <Button disabled={!count || pending} onClick={() => startTransition(async () => void finish(await restoreConversations({ ids: [...s.ids] })))}>
          <Undo2 aria-hidden="true" /> Restaurar
        </Button>
      ) : (
        <div className="flex flex-wrap gap-2 [&>*]:flex-auto">
          <ConfirmDialog
            trigger={
              <Button variant="outline" className="text-danger" disabled={!count}>
                Excluir
              </Button>
            }
            title={`Excluir ${count} ${plural(count)}?`}
            description="As mensagens saem do sistema, e o WhatsApp do celular não muda. Grupo excluído não volta sozinho; conversa individual volta se a pessoa escrever. Leads e negócios continuam, e dá para restaurar em Excluídas."
            confirmLabel="Excluir"
            onConfirm={async () => finish(await excludeConversations({ ids: [...s.ids] }))}
          />
          {groupsTab && others > 0 && (
            <ConfirmDialog
              trigger={
                <Button variant="outline" disabled={!count}>
                  Manter só os marcados
                </Button>
              }
              title={others === 1 ? "Excluir o outro grupo?" : `Excluir os outros ${others} grupos?`}
              description={`${count === 1 ? "Fica só o que você marcou" : `Ficam só os ${count} que você marcou`}. As mensagens dos outros saem do sistema, e eles não voltam sozinhos. Dá para restaurar em Excluídas.`}
              confirmLabel="Manter só os marcados"
              onConfirm={async () => finish(await excludeAllGroupsExcept({ keep: [...s.ids], numberId }))}
            />
          )}
        </div>
      )}
    </div>
  );
}
