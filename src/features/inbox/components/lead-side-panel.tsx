"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PanelRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { moveDeal, setNextContact } from "@/features/crm/actions";

type Stage = { id: string; name: string; kind: string };
export type PanelDeal = { id: string; stage_id: string; pipeline_name: string; stages: Stage[] };

/** Valor de um campo datetime-local no horário de quem está usando. */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** O essencial do lead sem sair da conversa: funil, próximo contato, tarefas e reuniões. */
export function LeadSidePanel({
  lead,
  deals,
  nextContactAt,
  canMove,
  canUpdate,
  children,
}: {
  lead: { id: string; name: string };
  deals: PanelDeal[];
  nextContactAt: string | null;
  canMove: boolean;
  canUpdate: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [next, setNext] = useState(toLocalInput(nextContactAt));
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
      router.refresh();
    });
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          <PanelRight aria-hidden="true" /> Lead
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{lead.name}</SheetTitle>
          <SheetDescription>
            <Link href={`/crm/leads/${lead.id}`} className="text-primary hover:underline">
              Abrir o lead completo
            </Link>
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-6 px-4 pb-6">
          <section aria-labelledby="painel-funil" className="grid gap-2">
            <h3 id="painel-funil" className="text-sm font-semibold">
              Funil
            </h3>
            {deals.length === 0 && <p className="text-sm text-muted-foreground">Este lead não está em nenhum funil.</p>}
            {deals.map((d) => (
              <div key={d.id} className="grid gap-1.5">
                <Label htmlFor={`etapa-${d.id}`}>{d.pipeline_name}</Label>
                <Select
                  value={d.stage_id}
                  disabled={!canMove || pending}
                  onValueChange={(stageId) => run(() => moveDeal({ dealId: d.id, stageId, position: Date.now() / 1000 }))}
                >
                  <SelectTrigger id={`etapa-${d.id}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Marcar como perdido pede o motivo: isso fica na tela do funil. */}
                    {d.stages
                      .filter((s) => s.kind !== "lost" || s.id === d.stage_id)
                      .map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </section>

          <section aria-labelledby="painel-contato" className="grid gap-2">
            <h3 id="painel-contato" className="text-sm font-semibold">
              Próximo contato
            </h3>
            <div className="flex items-center gap-2">
              <Input type="datetime-local" aria-label="Data e hora do próximo contato" value={next} disabled={!canUpdate} onChange={(e) => setNext(e.target.value)} />
              <Button
                variant="outline"
                size="sm"
                disabled={!canUpdate || pending || next === toLocalInput(nextContactAt)}
                onClick={() => run(() => setNextContact({ leadId: lead.id, at: next ? new Date(next).toISOString() : null }))}
              >
                Salvar
              </Button>
            </div>
          </section>

          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
