import { cn } from "cn";

/** Marca do HubSystem: um nó central ligado a três pontos (o "hub"). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8", className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <g className="stroke-primary-foreground" strokeWidth="2" strokeLinecap="round">
        <path d="M16 16 L9 9 M16 16 L23 9 M16 16 L16 24" />
      </g>
      <circle cx="16" cy="16" r="3.5" className="fill-signal" />
      <g className="fill-primary-foreground">
        <circle cx="9" cy="9" r="2" />
        <circle cx="23" cy="9" r="2" />
        <circle cx="16" cy="24" r="2" />
      </g>
    </svg>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <BrandMark className="size-7" />
      <span>HubSystem</span>
    </span>
  );
}
