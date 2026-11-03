import type { Metadata } from "next";
import { requireFinance } from "@/features/finance/server";
import { getLookups } from "@/features/finance/queries";
import { AccountsEditor, CategoriesEditor, CostCentersEditor } from "@/features/finance/components/registry-editor";
import { TagsToCategories } from "@/features/finance/components/tags-to-categories";
import { PaymentProfileForm } from "@/features/finance/components/payment-profile-form";
import type { PaymentProfile } from "@/domain/finance/charge";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Contas e categorias" };

export default async function CadastrosPage({ params }: PageProps<"/financeiro/[contexto]/cadastros">) {
  const { contexto } = await params;
  const { scope, perms, user } = await requireFinance(contexto);
  const supabase = await createClient();
  const profileQuery = supabase.from("payment_profiles").select("pix_key, pix_key_type, holder_name, bank_name, instructions").eq("scope", scope);
  const [lookups, tags, profile] = await Promise.all([getLookups(scope), supabase.from("tags").select("id, name").order("name"), (scope === "pessoal" ? profileQuery.eq("owner_user_id", user.id) : profileQuery).maybeSingle()]);
  return (
    <div className="grid max-w-4xl gap-8">
      <PaymentProfileForm scope={scope} profile={(profile.data as PaymentProfile | null) ?? null} canEdit={perms.update} />
      <AccountsEditor scope={scope} accounts={lookups.accounts} canEdit={perms.update} />
      <CategoriesEditor scope={scope} categories={lookups.categories} canEdit={perms.update} />
      {perms.create && <TagsToCategories scope={scope} tags={(tags.data ?? []) as { id: string; name: string }[]} categories={lookups.categories} />}
      {scope === "empresa" && <CostCentersEditor centers={lookups.costCenters} canEdit={perms.update} />}
    </div>
  );
}
