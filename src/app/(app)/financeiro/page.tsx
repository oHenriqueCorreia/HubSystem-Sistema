import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/dal";

export default async function FinanceiroPage() {
  const user = await requireUser();
  if (user.permissions["finance.company.read"]) redirect("/financeiro/empresa");
  if (user.permissions["finance.personal.manage"]) redirect("/financeiro/pessoal");
  redirect("/sem-acesso");
}
