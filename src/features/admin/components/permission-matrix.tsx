"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SCOPE_LABEL, type PermissionKey, type PermissionScope } from "@/domain/permissions";
import { setPermissionOverride, setRolePermission } from "../actions";
import type { PermissionDef } from "../queries";

const NONE = "nenhum";
// Permissões em que o escopo (próprios/equipe/todos) faz sentido.
const SCOPED = /^(crm\.leads\.|crm\.pipeline\.move|clients\.|contracts\.|tasks\.|calendar\.|dashboards\.commercial)/;

/** Matriz de um papel: para cada permissão, nenhum / próprios / equipe / todos. */
export function RolePermissionMatrix({
  roleId,
  groups,
  scopes,
  readOnly,
}: {
  roleId: string;
  groups: [string, PermissionDef[]][];
  scopes: Record<string, PermissionScope>;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(scopes);
  const [pending, startTransition] = useTransition();

  function change(key: string, value: string) {
    const scope = value === NONE ? null : (value as PermissionScope);
    const before = state;
    setState((s) => {
      const next = { ...s };
      if (scope) next[key] = scope;
      else delete next[key];
      return next;
    });
    startTransition(async () => {
      const res = await setRolePermission({ roleId, permissionKey: key as PermissionKey, scope });
      if (!res.ok) {
        setState(before);
        toast.error(res.message);
      } else router.refresh();
    });
  }

  return (
    <div className="grid gap-6">
      {groups.map(([module, perms]) => (
        <fieldset key={module} className="rounded-xl border bg-surface">
          <legend className="ml-3 px-1 text-sm font-semibold">{module}</legend>
          <ul className="divide-y">
            {perms.map((p) => (
              <li key={p.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <label htmlFor={`rp-${p.key}`} className="text-sm">
                  {p.label}
                </label>
                <Select value={state[p.key] ?? NONE} onValueChange={(v) => change(p.key, v)} disabled={readOnly || pending}>
                  <SelectTrigger id={`rp-${p.key}`} className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem acesso</SelectItem>
                    {SCOPED.test(p.key) ? (
                      (["own", "team", "all"] as const).map((s) => (
                        <SelectItem key={s} value={s}>
                          {SCOPE_LABEL[s]}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="all">Permitido</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}

/** Exceções por usuário sobre o papel: seguir papel / liberar / bloquear. */
export function UserOverrideMatrix({
  userId,
  groups,
  roleScopes,
  overrides,
}: {
  userId: string;
  groups: [string, PermissionDef[]][];
  roleScopes: Record<string, PermissionScope>;
  overrides: Record<string, { effect: "grant" | "deny"; scope: PermissionScope }>;
}) {
  const router = useRouter();
  const [state, setState] = useState(overrides);
  const [pending, startTransition] = useTransition();

  function change(key: string, value: string) {
    const before = state;
    let effect: "grant" | "deny" | null = null;
    let scope: PermissionScope = "all";
    if (value === "deny") effect = "deny";
    else if (value.startsWith("grant:")) {
      effect = "grant";
      scope = value.split(":")[1] as PermissionScope;
    }
    setState((s) => {
      const next = { ...s };
      if (effect) next[key] = { effect, scope };
      else delete next[key];
      return next;
    });
    startTransition(async () => {
      const res = await setPermissionOverride({ userId, permissionKey: key as PermissionKey, effect, scope });
      if (!res.ok) {
        setState(before);
        toast.error(res.message);
      } else router.refresh();
    });
  }

  return (
    <div className="grid gap-6">
      {groups.map(([module, perms]) => (
        <fieldset key={module} className="rounded-xl border bg-surface">
          <legend className="ml-3 px-1 text-sm font-semibold">{module}</legend>
          <ul className="divide-y">
            {perms.map((p) => {
              const o = state[p.key];
              const value = o ? (o.effect === "deny" ? "deny" : `grant:${o.scope}`) : "role";
              const fromRole = roleScopes[p.key];
              return (
                <li key={p.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                  <div className="grid">
                    <label htmlFor={`uo-${p.key}`} className="text-sm">
                      {p.label}
                    </label>
                    <span className="text-xs text-muted-foreground">Pelo papel: {fromRole ? (SCOPED.test(p.key) ? SCOPE_LABEL[fromRole] : "Permitido") : "Sem acesso"}</span>
                  </div>
                  <Select value={value} onValueChange={(v) => change(p.key, v)} disabled={pending}>
                    <SelectTrigger id={`uo-${p.key}`} className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="role">Seguir o papel</SelectItem>
                      <SelectItem value="deny">Bloquear</SelectItem>
                      {SCOPED.test(p.key) ? (
                        (["own", "team", "all"] as const).map((s) => (
                          <SelectItem key={s} value={`grant:${s}`}>
                            Liberar: {SCOPE_LABEL[s].toLowerCase()}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="grant:all">Liberar</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}
