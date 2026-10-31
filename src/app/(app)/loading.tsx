import { Skeleton } from "@/components/ui/skeleton";

export default function AppLoading() {
  return (
    <div className="grid gap-4 px-4 pt-5 sm:px-6" role="status" aria-label="Carregando">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-7 w-64" />
      <div className="mt-4 grid gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
      <span className="sr-only">Carregando…</span>
    </div>
  );
}
