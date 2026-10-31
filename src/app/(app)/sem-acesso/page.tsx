import type { Metadata } from "next";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { NoPermission } from "@/components/app/states";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Sem acesso" };

export default function SemAcessoPage() {
  return (
    <>
      <PageHeader title="Sem acesso" />
      <PageBody>
        <div className="grid max-w-xl gap-4">
          <NoPermission />
          <Button asChild variant="outline" className="justify-self-start">
            <Link href="/inicio">Voltar para o início</Link>
          </Button>
        </div>
      </PageBody>
    </>
  );
}
