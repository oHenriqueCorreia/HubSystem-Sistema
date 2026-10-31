import type { ReactNode } from "react";
import { CircleAlert, Lock, SearchX, WifiOff, type LucideIcon } from "lucide-react";
import { cn } from "cn";

/** Estado vazio útil: explica e oferece a próxima ação. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 rounded-xl border border-dashed bg-surface px-5 py-8 sm:items-center sm:text-center",
        className,
      )}
    >
      {Icon && <Icon className="size-6 text-muted-foreground" aria-hidden="true" />}
      <div className="grid gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export function NoResults({ query, onClear }: { query?: string; onClear?: ReactNode }) {
  return (
    <EmptyState
      icon={SearchX}
      title="Nada encontrado"
      description={query ? `Nenhum resultado para “${query}”. Tente outro termo ou limpe os filtros.` : "Nenhum resultado com esses filtros."}
      action={onClear}
    />
  );
}

export function ErrorState({
  title = "Não foi possível carregar",
  description = "Verifique sua conexão e tente novamente.",
  action,
  offline,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  offline?: boolean;
}) {
  const Icon = offline ? WifiOff : CircleAlert;
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft px-5 py-6">
      <Icon className="size-5 text-danger" aria-hidden="true" />
      <div className="grid gap-1">
        <h2 className="text-base font-semibold text-danger">{title}</h2>
        <p className="text-sm text-foreground/80">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function NoPermission({ what }: { what?: string }) {
  return (
    <EmptyState
      icon={Lock}
      title="Sem acesso"
      description={`Você não tem permissão para ${what ?? "ver esta área"}. Peça ao administrador para liberar.`}
    />
  );
}
