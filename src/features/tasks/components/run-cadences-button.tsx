"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runCadencesNow } from "../actions";

/** Executa agora as etapas automáticas que já venceram (o cron roda uma vez por dia). */
export function RunCadencesButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await runCadencesNow({});
          if (res.ok) toast.success(res.message);
          else toast.error(res.message);
          router.refresh();
        })
      }
    >
      {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />} Executar automações agora
    </Button>
  );
}
