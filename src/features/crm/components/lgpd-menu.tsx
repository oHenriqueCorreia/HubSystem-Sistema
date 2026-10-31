"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, LoaderCircle, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { lgpdAnonymize } from "../actions";

/** Direitos do titular (LGPD): exportar dados e anonimizar. */
export function LgpdMenu({ leadId, name }: { leadId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost">LGPD</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Direitos do titular</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <a href={`/api/lgpd/leads/${leadId}`} download>
              <Download aria-hidden="true" /> Exportar dados (JSON)
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem className="text-danger" onSelect={() => setOpen(true)}>
            <ShieldOff aria-hidden="true" /> Anonimizar dados pessoais
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger className="hidden" />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anonimizar “{name}”?</DialogTitle>
            <DialogDescription>
              Remove nome, telefones, e-mail, endereço, redes, anotações e anexos de forma <strong>irreversível</strong>. Contratos e lançamentos financeiros são mantidos por obrigação
              legal, sem dados pessoais. A ação fica registrada na auditoria.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="lgpd-reason">Motivo (ex.: pedido do titular em 30/10/2026)</Label>
              <Textarea id="lgpd-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lgpd-confirm">Digite ANONIMIZAR para confirmar</Label>
              <input id="lgpd-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm" autoComplete="off" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={pending || confirm !== "ANONIMIZAR" || reason.trim().length < 5}
              onClick={() =>
                startTransition(async () => {
                  const res = await lgpdAnonymize({ leadId, reason });
                  if (!res.ok) return void toast.error(res.message);
                  toast.success(res.message);
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Anonimizar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
