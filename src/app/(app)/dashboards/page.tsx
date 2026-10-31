import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/dal";

export default async function DashboardsPage() {
  const user = await requireUser();
  if (user.permissions["dashboards.commercial"]) redirect("/dashboards/comercial");
  if (user.permissions["dashboards.financial"]) redirect("/dashboards/financeiro");
  redirect("/sem-acesso");
}
