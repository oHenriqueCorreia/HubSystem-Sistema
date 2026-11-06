import Link from "next/link";
import { SCOPE_LABEL, hasScope, type PermissionMap, type PermissionScope } from "@/domain/permissions";
import { formatDateTime } from "@/domain/shared/dates";
import { SETTINGS_PAGES, visibleNavGroups } from "@/config/navigation";
import type { AccessEvent, UserClientLinks } from "../access-queries";

type Names = { permissions: Map<string, string>; roles: Map<string, string>; people: Map<string, string>; clients: Map<string, string>; squads: Map<string, string> };

const scopeText = (v: unknown) => (typeof v === "string" && v in SCOPE_LABEL ? SCOPE_LABEL[v as PermissionScope].toLowerCase() : "");
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Uma linha do histórico em linguagem simples. */
function describe(e: AccessEvent, n: Names): string {
  const c = e.changes;
  const perm = n.permissions.get(str(c.permission_key)) ?? str(c.permission_key);
  const change = (k: string) => c[k] as { de?: unknown; para?: unknown } | undefined;
  switch (e.entity_type) {
    case "role_permissions":
      if (e.action === "insert") return `Permissão “${perm}” concedida${hasScope(str(c.permission_key)) ? ` (${scopeText(c.scope)})` : ""}`;
      if (e.action === "delete") return `Permissão “${perm}” removida`;
      return `“${perm}”: escopo de ${scopeText(change("scope")?.de)} para ${scopeText(change("scope")?.para)}`;
    case "roles":
      if (e.action === "insert") return "Papel criado";
      if (e.action === "delete") return "Papel excluído";
      return `Papel editado (${Object.keys(c).join(", ")})`;
    case "user_roles":
      if (e.action === "insert") return `Papel definido: ${n.roles.get(str(c.role_id)) ?? "papel excluído"}`;
      if (e.action === "delete") return `Papel retirado: ${n.roles.get(str(c.role_id)) ?? "papel excluído"}`;
      return "Papel alterado";
    case "user_permission_overrides": {
      if (e.action === "delete") return `Exceção em “${perm}” removida (volta a seguir o papel)`;
      const effect = str(c.effect) || str(change("effect")?.para);
      return effect === "deny" ? `Exceção em “${perm}”: bloquear` : `Exceção em “${perm}”: liberar${hasScope(str(c.permission_key)) ? ` (${scopeText(c.scope ?? change("scope")?.para)})` : ""}`;
    }
    case "client_members":
      return `${e.action === "delete" ? "Removida do cliente" : "Associada ao cliente"} ${n.clients.get(str(c.client_id)) ?? "(cliente fora do seu acesso)"}${str(c.role_label) ? ` como ${str(c.role_label)}` : ""}`;
    case "team_members":
      return `${e.action === "delete" ? "Saiu do squad" : "Entrou no squad"} ${n.squads.get(str(c.team_id)) ?? "(squad excluído)"}`;
    case "profiles":
      if (change("is_active")) return change("is_active")?.para ? "Conta reativada" : "Conta desativada";
      return `Perfil alterado (${Object.keys(c).join(", ")})`;
    default:
      return `${e.entity_type}: ${e.action}`;
  }
}

export function AccessHistory({ events, names, empty }: { events: AccessEvent[]; names: Names; empty: string }) {
  return (
    <section aria-labelledby="historico-acesso" className="grid gap-2">
      <h2 id="historico-acesso" className="text-base font-semibold">
        Histórico de acesso
      </h2>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ol className="divide-y rounded-xl border bg-surface">
          {events.map((e) => (
            <li key={e.id} className="grid gap-0.5 px-4 py-2 text-sm">
              <span className="wrap-break-word">{describe(e, names)}</span>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(e.created_at)} · {e.actor_id ? (names.people.get(e.actor_id) ?? "pessoa removida") : "sistema"}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-muted-foreground">
        Registro completo em <Link href="/configuracoes/auditoria" className="text-primary underline-offset-4 hover:underline">Auditoria</Link>.
      </p>
    </section>
  );
}

/**
 * "Ver como esta pessoa": o que ela enxerga, calculado com a mesma regra do menu real.
 * Só leitura: nada aqui age em nome dela.
 */
export function ViewAsPreview({
  name,
  permissions,
  links,
  clientName,
  clientsScope,
}: {
  name: string;
  permissions: PermissionMap;
  links: UserClientLinks;
  clientName: (id: string) => string;
  clientsScope: PermissionScope | undefined;
}) {
  const menu = visibleNavGroups(permissions, false);
  const settings = SETTINGS_PAGES.filter((p) => !p.perm || permissions[p.perm]);
  const fields = [
    { label: "Valores de contratos e preços", ok: Boolean(permissions["contracts.values"]) },
    { label: "CPF/CNPJ e contatos de cobrança", ok: Boolean(permissions["clients.billing"]) },
    { label: "Financeiro da empresa", ok: Boolean(permissions["finance.company.read"]) },
  ];
  const squadClients = links.squads.flatMap((s) => s.clientIds);

  return (
    <section aria-labelledby="ver-como" className="grid gap-4 rounded-xl border bg-surface p-4">
      <div className="grid gap-1">
        <h2 id="ver-como" className="text-base font-semibold">
          Ver como {name}
        </h2>
        <p className="text-sm text-muted-foreground">Pré-visualização só de leitura do que esta pessoa vê hoje, com as permissões efetivas abaixo. Nada aqui age em nome dela.</p>
      </div>
      <dl className="grid gap-4 text-sm md:grid-cols-2">
        <div className="grid content-start gap-1">
          <dt className="font-medium">Menu</dt>
          <dd className="text-muted-foreground">
            {menu.length === 0 ? "Só o Início." : menu.map((g) => `${g.label}: ${g.items.map((i) => i.label).join(", ")}`).join(" · ")}
          </dd>
        </div>
        <div className="grid content-start gap-1">
          <dt className="font-medium">Configurações</dt>
          <dd className="text-muted-foreground">{settings.map((p) => p.label).join(", ")}</dd>
        </div>
        <div className="grid content-start gap-1">
          <dt className="font-medium">Campos sensíveis</dt>
          <dd>
            <ul className="grid gap-0.5">
              {fields.map((f) => (
                <li key={f.label}>
                  {f.ok ? "Vê" : "Não vê"}: <span className="text-muted-foreground">{f.label}</span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div className="grid content-start gap-1">
          <dt className="font-medium">Clientes</dt>
          <dd className="grid gap-1 text-muted-foreground">
            <span>
              {!clientsScope
                ? "Sem permissão para ver clientes: as associações abaixo liberam só tarefas, agenda e conversas permitidas pelo papel."
                : clientsScope === "all"
                  ? "Vê todos os clientes."
                  : `Vê os clientes ${clientsScope === "own" ? "pelos quais é responsável" : "da própria equipe"}, mais os associados abaixo.`}
            </span>
            {links.direct.length > 0 && <span>Direto: {links.direct.map((d) => `${clientName(d.client_id)}${d.role_label ? ` (${d.role_label})` : ""}`).join(", ")}</span>}
            {links.squads.map((s) => (
              <span key={s.id}>
                Squad {s.name}: {s.clientIds.length ? s.clientIds.map(clientName).join(", ") : "sem clientes"}
              </span>
            ))}
            {links.direct.length === 0 && squadClients.length === 0 && <span>Nenhum cliente associado.</span>}
          </dd>
        </div>
      </dl>
    </section>
  );
}
