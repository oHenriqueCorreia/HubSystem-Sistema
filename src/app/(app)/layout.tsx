import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/app-shell";
import { getCurrentUser } from "@/lib/auth/dal";
import { NAV_GROUPS, SETTINGS_ITEM } from "@/config/navigation";
import { canAny } from "@/domain/permissions";
import { canCreateWorkspaces } from "@/features/admin/queries";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  // Sessão válida mas perfil desativado/inexistente: encerra a sessão.
  if (!user) redirect("/auth/sair?motivo=desativado");

  const owner = await canCreateWorkspaces();
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => (!i.anyOf || canAny(user.permissions, i.anyOf)) && (!i.platformOwner || owner)),
  })).filter((g) => g.items.length > 0);

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <AppShell
      groups={groups}
      settings={SETTINGS_ITEM}
      user={{ fullName: user.fullName, email: user.email, roleNames: user.roles.map((r) => r.name) }}
      organizationName={user.organizationName}
      defaultOpen={defaultOpen}
    >
      {children}
    </AppShell>
  );
}
