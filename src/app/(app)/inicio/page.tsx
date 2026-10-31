import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { formatDate, todayLocal } from "@/domain/shared/dates";
import { getMyDay } from "@/features/tasks/queries";
import { getCrmLookups } from "@/features/crm/queries";
import { MyDay } from "@/features/tasks/components/my-day";
import { TaskFormDialog } from "@/features/tasks/components/task-form-dialog";

export const metadata: Metadata = { title: "Meu dia" };

function greeting(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(now));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export default async function InicioPage() {
  const user = await requireUser();
  const firstName = user.fullName.split(" ")[0];
  const canTasks = Boolean(user.permissions["tasks.read"]);
  const [day, lookups] = canTasks ? await Promise.all([getMyDay(user.id), getCrmLookups()]) : [null, null];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={`Hoje é ${formatDate(todayLocal())}.`}
        actions={
          user.permissions["tasks.create"] && lookups ? (
            <TaskFormDialog
              owners={lookups.owners}
              canAssign={user.permissions["tasks.create"] !== "own"}
              defaults={{ dueDate: todayLocal() }}
              trigger={
                <Button>
                  <Plus aria-hidden="true" /> Nova tarefa
                </Button>
              }
            />
          ) : null
        }
      />
      <PageBody>
        {day && lookups ? (
          <MyDay {...day} owners={lookups.owners} canDelete={Boolean(user.permissions["tasks.delete"])} />
        ) : (
          <div className="grid gap-2 text-sm text-muted-foreground">
            <p>Use o menu para acessar as áreas liberadas para você.</p>
            {user.permissions["finance.personal.manage"] && (
              <Link href="/financeiro/pessoal" className="text-primary hover:underline">
                Abrir meu financeiro pessoal
              </Link>
            )}
          </div>
        )}
      </PageBody>
    </>
  );
}
