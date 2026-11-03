"use client";

import { useState } from "react";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/** Números conectados ficam a um clique, sem ocupar o espaço da conversa. */
export function NumbersDialog({ children, alert, defaultOpen }: { children: React.ReactNode; alert: boolean; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Números conectados" title="Números conectados" className="relative">
          <Smartphone aria-hidden="true" />
          {alert && <span className="absolute top-0.5 right-0.5 size-2 rounded-full bg-danger" />}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Números conectados</DialogTitle>
          <DialogDescription>Os WhatsApps que recebem e enviam as mensagens deste atendimento.</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
