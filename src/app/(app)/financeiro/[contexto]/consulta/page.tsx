import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/dal";
import { listUsers } from "@/features/admin/queries";
import { AdminPersonalRead } from "@/features/finance/components/admin-personal-read";

export const metadata: Metadata = { title: "Consultar financeiro pessoal" };

export default async function ConsultaPage({ params }: PageProps<"/financeiro/[contexto]/consulta">) {
  const { contexto } = await params;
  if (contexto !== "pessoal") notFound();
  const me = await requirePermission("finance.personal.admin_read");
  const users = (await listUsers()).filter((u) => u.id !== me.id);
  return <AdminPersonalRead users={users.map((u) => ({ id: u.id, name: u.full_name || u.email }))} />;
}
