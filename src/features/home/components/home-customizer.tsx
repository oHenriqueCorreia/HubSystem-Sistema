"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, LayoutDashboard, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { saveHomeLayout } from "../actions";

type Widget = { key: string; label: string };

/** Escolher quais blocos aparecem na tela inicial e em que ordem. */
export function HomeCustomizer({ widgets, order, hidden }: { widgets: readonly Widget[]; order: string[]; hidden: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(order);
  const [off, setOff] = useState(new Set(hidden));
  const [pending, startTransition] = useTransition();
  const label = new Map(widgets.map((w) => [w.key, w.label]));

  function move(i: number, dir: -1 | 1) {
    const next = [...list];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    setList(next);
  }

  function save() {
    startTransition(async () => {
      const res = await saveHomeLayout({ order: list, hidden: [...off] });
      if (!res.ok) return void toast.error(res.message);
      toast.success(res.message);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <LayoutDashboard aria-hidden="true" /> Personalizar
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col">
        <SheetHeader>
          <SheetTitle>Personalizar a tela inicial</SheetTitle>
          <SheetDescription>Mostre só o que você usa e coloque na ordem que preferir.</SheetDescription>
        </SheetHeader>
        <ol className="grid flex-1 content-start gap-2 overflow-y-auto px-4">
          {list.map((k, i) => (
            <li key={k} className="flex items-center gap-2 rounded-lg border p-2">
              <Switch
                checked={!off.has(k)}
                onCheckedChange={(v) =>
                  setOff((cur) => {
                    const next = new Set(cur);
                    if (v) next.delete(k);
                    else next.add(k);
                    return next;
                  })
                }
                aria-label={`Mostrar ${label.get(k)}`}
              />
              <span className="flex-1 text-sm">{label.get(k)}</span>
              <Button variant="ghost" size="icon-xs" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Subir ${label.get(k)}`}>
                <ArrowUp aria-hidden="true" />
              </Button>
              <Button variant="ghost" size="icon-xs" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label={`Descer ${label.get(k)}`}>
                <ArrowDown aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ol>
        <SheetFooter>
          <Button onClick={save} disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
