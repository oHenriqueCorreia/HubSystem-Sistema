import { requireUser } from "@/lib/auth/dal";
import { SettingsNav } from "@/features/admin/components/settings-nav";
import { SETTINGS_PAGES } from "@/config/navigation";

export default async function SettingsLayout({ children }: LayoutProps<"/configuracoes">) {
  const user = await requireUser();
  const items = SETTINGS_PAGES.filter((i) => !i.perm || user.permissions[i.perm]);
  return (
    <div className="grid md:grid-cols-[13rem_minmax(0,1fr)]">
      <SettingsNav items={items} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
