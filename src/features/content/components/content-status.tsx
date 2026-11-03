import { cn } from "cn";
import { CONTENT_STATUS_LABEL, type ContentStatus } from "@/domain/content";

const STYLE: Record<ContentStatus, string> = {
  em_producao: "bg-muted text-foreground",
  aguardando_aprovacao: "bg-warning-soft text-warning",
  ajustes_solicitados: "bg-signal-soft text-signal",
  aprovado: "bg-success-soft text-success",
  agendado: "bg-info-soft text-info",
  publicado: "bg-accent text-accent-foreground",
  erro: "bg-danger-soft text-danger",
};

export function ContentStatusBadge({ status, className }: { status: ContentStatus; className?: string }) {
  return <span className={cn("inline-flex w-fit items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", STYLE[status], className)}>{CONTENT_STATUS_LABEL[status]}</span>;
}
