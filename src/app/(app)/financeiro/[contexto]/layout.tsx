import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requireFinance } from "@/features/finance/server";
import { getLookups, listContractsForFinance, prepareScope } from "@/features/finance/queries";
import { FinanceTabs } from "@/features/finance/components/finance-tabs";
import { TxnFormDialog } from "@/features/finance/components/txn-form-dialog";
import { SCOPE_LABEL } from "@/features/finance/types";

export default async function FinanceLayout({ children, params }: LayoutProps<"/financeiro/[contexto]">) {
  const { contexto } = await params;
  const { scope, user, perms } = await requireFinance(contexto);
  await prepareScope(scope);
  const [lookups, contracts] = await Promise.all([getLookups(scope), scope === "empresa" && user.permissions["contracts.read"] ? listContractsForFinance() : Promise.resolve([])]);

  return (
    <>
      <PageHeader
        accent={scope === "empresa" ? "company" : "personal"}
        breadcrumbs={[{ label: "Financeiro" }, { label: SCOPE_LABEL[scope] }]}
        title={scope === "empresa" ? "Financeiro da empresa" : "Meu financeiro pessoal"}
        description={scope === "pessoal" ? "Separado da empresa. Só você vê; o administrador consulta apenas com registro em auditoria." : undefined}
        actions={
          perms.create ? (
            <TxnFormDialog
              scope={scope}
              lookups={{ ...lookups, contracts }}
              trigger={
                <Button>
                  <Plus aria-hidden="true" /> Novo lançamento
                </Button>
              }
            />
          ) : null
        }
      />
      <div className="px-4 sm:px-6">
        <FinanceTabs scope={scope} showAdminRead={scope === "pessoal" && Boolean(user.permissions["finance.personal.admin_read"])} />
      </div>
      <div className="px-4 pt-5 pb-8 sm:px-6">{children}</div>
    </>
  );
}
