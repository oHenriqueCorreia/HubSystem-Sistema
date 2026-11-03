"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Archive, LoaderCircle, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormAlert, FormField } from "@/components/app/form-field";
import { archiveTaskBoard, createTaskBoard, createTaskColumn, updateTaskBoard } from "../actions";
import { STATUS_LABEL, type TaskBoard, type TaskStatus } from "../types";

const NONE = "__nenhum__";
const ALL = "__todos__";
const KINDS: TaskStatus[] = ["a_fazer", "em_andamento", "concluida", "cancelada"];

/** Escolha do quadro e os atalhos para criar quadros e listas. */
export function BoardBar({ boards, current, clients, canConfigure }: { boards: TaskBoard[]; current: TaskBoard | null; clients: { id: string; legal_name: string }[]; canConfigure: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [dialog, setDialog] = useState<"novo" | "editar" | "lista" | null>(null);

  const listMode = params.get("modo") !== "quadro";

  function pick(id: string) {
    const q = new URLSearchParams(params.toString());
    if (id === ALL) q.delete("quadro");
    else q.set("quadro", id);
    q.delete("tarefa");
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={current?.id ?? (listMode ? ALL : "")} onValueChange={pick}>
        <SelectTrigger className="w-64 max-w-full" aria-label="Quadro">
          <SelectValue placeholder="Escolha o quadro" />
        </SelectTrigger>
        <SelectContent>
          {listMode && <SelectItem value={ALL}>Todos os quadros</SelectItem>}
          {boards.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {canConfigure && (
        <>
          <Button variant="outline" size="sm" onClick={() => setDialog("lista")}>
            <Plus aria-hidden="true" /> Nova lista
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDialog("novo")}>
            <Plus aria-hidden="true" /> Novo quadro
          </Button>
          {current && (
            <Button variant="ghost" size="sm" onClick={() => setDialog("editar")}>
              <Pencil aria-hidden="true" /> Editar quadro
            </Button>
          )}
          {current && !current.is_default && (
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm">
                  <Archive aria-hidden="true" /> Arquivar
                </Button>
              }
              title={`Arquivar o quadro “${current.name}”?`}
              description="Ele sai da lista de quadros. Tarefas em aberto precisam ser movidas ou concluídas antes."
              confirmLabel="Arquivar quadro"
              onConfirm={async () => {
                const res = await archiveTaskBoard({ id: current.id });
                if (!res.ok) return void toast.error(res.message);
                toast.success(res.message);
                const q = new URLSearchParams(params.toString());
                q.delete("quadro");
                router.replace(`${pathname}?${q.toString()}`, { scroll: false });
                router.refresh();
              }}
            />
          )}
        </>
      )}
      {dialog === "lista" && <ListDialog boards={boards} boardId={current?.id ?? boards[0]?.id ?? ""} onClose={() => setDialog(null)} />}
      {dialog === "novo" && <BoardDialog clients={clients} onClose={() => setDialog(null)} onCreated={pick} />}
      {dialog === "editar" && current && <BoardDialog board={current} clients={clients} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Nova lista: toda lista nasce dentro de um quadro, então sempre aparece nele. */
export function ListDialog({ boards, boardId, onClose, onCreated }: { boards: { id: string; name: string }[]; boardId: string; onClose: () => void; onCreated?: (listId: string, boardId: string) => void }) {
  const router = useRouter();
  const [board, setBoard] = useState(boardId);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TaskStatus>("em_andamento");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createTaskColumn({ boardId: board, name, kind, color: "slate" });
      if (!res.ok) return setError(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message);
      toast.success(`Lista criada em ${boards.find((b) => b.id === board)?.name ?? "o quadro"}.`);
      onCreated?.(res.data.id, board);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova lista</DialogTitle>
          <DialogDescription>A lista aparece no quadro escolhido, antes das listas de concluídos e cancelados.</DialogDescription>
        </DialogHeader>
        <form id="list-form" onSubmit={submit} className="grid gap-3" noValidate>
          <FormAlert>{error}</FormAlert>
          <FormField label="Quadro" required>
            <Select value={board} onValueChange={setBoard}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Escolha o quadro" />
              </SelectTrigger>
              <SelectContent>
                {boards.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Nome" required>
            <Input autoFocus autoComplete="off" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Em revisão, Aguardando cliente…" />
          </FormField>
          <FormField label="Situação das tarefas nesta lista" hint="Define como elas contam nos relatórios.">
            <Select value={kind} onValueChange={(v) => setKind(v as TaskStatus)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {STATUS_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form="list-form" disabled={pending || !name.trim() || !board}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Criar lista
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BoardDialog({ board, clients, onClose, onCreated }: { board?: TaskBoard; clients: { id: string; legal_name: string }[]; onClose: () => void; onCreated?: (id: string) => void }) {
  const router = useRouter();
  const [name, setName] = useState(board?.name ?? "");
  const [description, setDescription] = useState(board?.description ?? "");
  const [clientId, setClientId] = useState(board?.client_id ?? NONE);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = { name, description, clientId: clientId === NONE ? null : clientId };
    startTransition(async () => {
      const res = board ? await updateTaskBoard({ ...payload, id: board.id }) : await createTaskBoard(payload);
      if (!res.ok) return setError(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message);
      toast.success(res.message);
      if (res.data && onCreated) onCreated(res.data.id);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{board ? "Editar quadro" : "Novo quadro"}</DialogTitle>
          <DialogDescription>{board ? "O nome muda em todas as telas." : "O quadro já nasce com as listas A fazer, Em andamento, Concluído e Cancelado."}</DialogDescription>
        </DialogHeader>
        <form id="board-form" onSubmit={submit} className="grid gap-3" noValidate>
          <FormAlert>{error}</FormAlert>
          <FormField label="Nome" required>
            <Input autoFocus autoComplete="off" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Produção, Cliente Alfa…" />
          </FormField>
          <FormField label="Cliente" optional hint="Tarefas desse cliente vêm com este quadro já escolhido.">
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Nenhum</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.legal_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Descrição" optional>
            <Textarea rows={2} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form="board-form" disabled={pending || !name.trim()}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} {board ? "Salvar quadro" : "Criar quadro"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
