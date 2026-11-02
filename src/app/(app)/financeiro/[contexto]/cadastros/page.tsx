import type { Metadata } from "next";
import { requireFinance } from "@/features/finance/server";
import { getLookups } from "@/features/finance/queries";
import { AccountsEditor, CategoriesEditor, CostCentersEditor } from "@/features/finance/components/registry-editor";
import { TagsToCategories } from "@/features/finance/components/tags-to-categories";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Contas e categorias" };

export default async function CadastrosPage({ params }: PageProps<"/financeiro/[contexto]/cadastros">) {
  const { contexto } = await params;
  const { scope, perms } = await requireFinance(contexto);
  const supabase = await createClient();
  const [lookups, tags] = await Promise.all([getLookups(scope), supabase.from("tags").select("id, name").order("name")]);
  return (
    <div className="grid max-w-4xl gap-8">
      <AccountsEditor scope={scope} accounts={lookups.accounts} canEdit={perms.update} />
      <CategoriesEditor scope={scope} categories={lookups.categories} canEdit={perms.update} />
      {perms.create && <TagsToCategories scope={scope} tags={(tags.data ?? []) as { id: string; name: string }[]} categories={lookups.categories} />}
      {scope === "empresa" && <CostCentersEditor centers={lookups.costCenters} canEdit={perms.update} />}
    </div>
  );
}
