"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function PipelinePicker({ pipelines, value }: { pipelines: { id: string; name: string }[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        const next = new URLSearchParams(params.toString());
        next.set("funil", v);
        router.replace(`${pathname}?${next.toString()}`);
      }}
    >
      <SelectTrigger className="w-48" aria-label="Funil">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {pipelines.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
