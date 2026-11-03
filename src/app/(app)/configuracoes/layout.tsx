import { requireUser } from "@/lib/auth/dal";
import { SettingsNav } from "@/features/admin/components/settings-nav";
import type { PermissionKey } from "@/domain/permissions";

const ITEMS: { href: string; label: string; perm?: PermissionKey }[] = [
  { href: "/configuracoes/perfil", label: "Meu perfil" },
  { href: "/configuracoes/notificacoes", label: "Notificações" },
  { href: "/configuracoes/geral", label: "Empresa", perm: "admin.settings" },
  { href: "/configuracoes/usuarios", label: "Usuários", perm: "admin.users" },
  { href: "/configuracoes/papeis", label: "Papéis e permissões", perm: "admin.roles" },
  { href: "/configuracoes/etiquetas", label: "Etiquetas", perm: "tags.manage" },
  { href: "/configuracoes/integracoes", label: "Integrações" },
  { href: "/configuracoes/auditoria", label: "Auditoria", perm: "admin.audit" },
];

export default async function SettingsLayout({ children }: LayoutProps<"/configuracoes">) {
  const user = await requireUser();
  const items = ITEMS.filter((i) => !i.perm || user.permissions[i.perm]);
  return (
    <div className="grid md:grid-cols-[13rem_minmax(0,1fr)]">
      <SettingsNav items={items} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
