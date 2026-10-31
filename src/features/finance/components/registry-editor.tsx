"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MoneyInput } from "@/components/app/money-input";
import { formatBRL } from "@/domain/shared/money";
import { saveAccount, saveCategory, saveCostCenter } from "../actions";
import { ACCOUNT_TYPE_LABEL, type Account, type Category, type CostCenter, type FinanceScope } from "../types";

function useSave() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, done?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.message);
      toast.success(res.message);
      done?.();
      router.refresh();
    });
  return { pending, run };
}

export function AccountsEditor({ scope, accounts, canEdit }: { scope: FinanceScope; accounts: Account[]; canEdit: boolean }) {
  const { pending, run } = useSave();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", type: "corrente", opening: 0 as number | null, active: true });

  function start(a?: Account) {
    setEditing(a?.id ?? "novo");
    setDraft({ name: a?.name ?? "", type: a?.type ?? "corrente", opening: a?.opening_balance_cents ?? 0, active: a?.is_active ?? true });
  }

  const form = (id?: string) => (
    <li className="grid gap-2 rounded-lg border bg-surface p-3 sm:grid-cols-[1fr_11rem_10rem_auto_auto] sm:items-center">
      <Input aria-label="Nome da conta" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Nome da conta…" autoFocus />
      <Select value={draft.type} onValueChange={(t) => setDraft({ ...draft, type: t })}>
        <SelectTrigger aria-label="Tipo de conta" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(ACCOUNT_TYPE_LABEL).map(([k, l]) => (
            <SelectItem key={k} value={k}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <MoneyInput aria-label="Saldo inicial" value={draft.opening} onChange={(c) => setDraft({ ...draft, opening: c })} />
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={draft.active} onCheckedChange={(v) => setDraft({ ...draft, active: v })} /> Ativa
      </label>
      <div className="flex gap-1">
        <Button
          size="icon-sm"
          aria-label="Salvar conta"
          disabled={pending || draft.name.trim().length < 2}
          onClick={() =>
            run(
              () => saveAccount({ id, scope, name: draft.name, type: draft.type as Account["type"] as "corrente", openingBalanceCents: draft.opening ?? 0, isActive: draft.active }),
              () => setEditing(null),
            )
          }
        >
          <Check aria-hidden="true" />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Cancelar" onClick={() => setEditing(null)}>
          <X aria-hidden="true" />
        </Button>
      </div>
    </li>
  );

  return (
    <section aria-labelledby="contas-fin" className="grid gap-2">
      <div className="flex items-center justify-between">
        <h2 id="contas-fin" className="text-sm font-semibold">
          Contas
        </h2>
        {canEdit && editing === null && (
          <Button size="sm" variant="outline" onClick={() => start()}>
            <Plus aria-hidden="true" /> Nova conta
          </Button>
        )}
      </div>
      <ul className="grid gap-2">
        {editing === "novo" && form()}
        {accounts.map((a) =>
          editing === a.id ? (
            <div key={a.id}>{form(a.id)}</div>
          ) : (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border bg-surface px-3 py-2 text-sm">
              <span className={a.is_active ? "" : "text-muted-foreground line-through"}>
                <span className="font-medium">{a.name}</span> · {ACCOUNT_TYPE_LABEL[a.type]} · saldo inicial {formatBRL(a.opening_balance_cents)}
              </span>
              {canEdit && (
                <Button size="icon-sm" variant="ghost" aria-label={`Editar ${a.name}`} onClick={() => start(a)}>
                  <Pencil aria-hidden="true" />
                </Button>
              )}
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

export function CategoriesEditor({ scope, categories, canEdit }: { scope: FinanceScope; categories: Category[]; canEdit: boolean }) {
  const { pending, run } = useSave();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"receita" | "despesa">("despesa");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const list = (k: "receita" | "despesa") => (
    <div className="grid gap-1">
      <h3 className="text-xs font-medium text-muted-foreground">{k === "receita" ? "Receitas" : "Despesas"}</h3>
      <ul className="grid gap-1">
        {categories
          .filter((c) => c.kind === k)
          .map((c) => (
            <li key={c.id} className="flex min-h-9 items-center justify-between gap-2 rounded-md border bg-surface px-3 text-sm">
              {renaming?.id === c.id ? (
                <span className="flex flex-1 gap-1 py-1">
                  <Input aria-label="Novo nome" value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} autoFocus />
                  <Button size="icon-sm" aria-label="Salvar" disabled={pending} onClick={() => run(() => saveCategory({ id: c.id, scope, name: renaming.name, kind: c.kind, isActive: c.is_active }), () => setRenaming(null))}>
                    <Check aria-hidden="true" />
                  </Button>
                </span>
              ) : (
                <span className={c.is_active ? "" : "text-muted-foreground line-through"}>{c.name}</span>
              )}
              {canEdit && renaming?.id !== c.id && (
                <span className="flex items-center gap-1">
                  <Switch
                    checked={c.is_active}
                    aria-label={c.is_active ? `Desativar ${c.name}` : `Ativar ${c.name}`}
                    onCheckedChange={(v) => run(() => saveCategory({ id: c.id, scope, name: c.name, kind: c.kind, isActive: v }))}
                  />
                  <Button size="icon-sm" variant="ghost" aria-label={`Renomear ${c.name}`} onClick={() => setRenaming({ id: c.id, name: c.name })}>
                    <Pencil aria-hidden="true" />
                  </Button>
                </span>
              )}
            </li>
          ))}
      </ul>
    </div>
  );

  return (
    <section aria-labelledby="cats" className="grid gap-3">
      <h2 id="cats" className="text-sm font-semibold">
        Categorias
      </h2>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Nome da nova categoria" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nova categoria…" className="w-56" />
          <Select value={kind} onValueChange={(k) => setKind(k as "receita" | "despesa")}>
            <SelectTrigger className="w-32" aria-label="Tipo da categoria">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="despesa">Despesa</SelectItem>
              <SelectItem value="receita">Receita</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" disabled={pending || name.trim().length < 2} onClick={() => run(() => saveCategory({ scope, name, kind, isActive: true }), () => setName(""))}>
            <Plus aria-hidden="true" /> Adicionar
          </Button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {list("receita")}
        {list("despesa")}
      </div>
    </section>
  );
}

export function CostCentersEditor({ centers, canEdit }: { centers: CostCenter[]; canEdit: boolean }) {
  const { pending, run } = useSave();
  const [name, setName] = useState("");
  return (
    <section aria-labelledby="ccs" className="grid gap-2">
      <h2 id="ccs" className="text-sm font-semibold">
        Centros de custo
      </h2>
      {canEdit && (
        <div className="flex gap-2">
          <Input aria-label="Novo centro de custo" value={name} onChange={(e) => setName(e.target.value)} placeholder="Novo centro de custo…" className="w-56" />
          <Button variant="outline" disabled={pending || name.trim().length < 2} onClick={() => run(() => saveCostCenter({ name, isActive: true }), () => setName(""))}>
            <Plus aria-hidden="true" /> Adicionar
          </Button>
        </div>
      )}
      <ul className="flex flex-wrap gap-2">
        {centers.map((c) => (
          <li key={c.id} className="flex items-center gap-2 rounded-md border bg-surface px-3 py-1.5 text-sm">
            <span className={c.is_active ? "" : "text-muted-foreground line-through"}>{c.name}</span>
            {canEdit && (
              <Switch checked={c.is_active} aria-label={c.is_active ? `Desativar ${c.name}` : `Ativar ${c.name}`} onCheckedChange={(v) => run(() => saveCostCenter({ id: c.id, name: c.name, isActive: v }))} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
