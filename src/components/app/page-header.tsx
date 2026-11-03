import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "cn";

export type Crumb = { label: string; href?: string };

/**
 * Cabeçalho contextual: trilha, título, descrição e ações.
 * Regra: no máximo UMA ação primária em `actions`.
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  className,
  accent,
}: {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  className?: string;
  /** Marca lateral de contexto (ex.: financeiro pessoal × empresa). */
  accent?: "company" | "personal";
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 px-4 pt-5 pb-4 sm:px-6 md:flex-row md:items-end md:justify-between",
        accent && "border-l-4",
        accent === "company" && "border-ctx-company",
        accent === "personal" && "border-ctx-personal",
        className,
      )}
    >
      <div className="grid min-w-0 gap-1">
        {breadcrumbs && breadcrumbs.length > 0 && (
          // Trilha sem link não leva a lugar nenhum: no celular, só ocuparia espaço.
          <Breadcrumb className={breadcrumbs.some((c) => c.href) ? undefined : "max-md:hidden"}>
            <BreadcrumbList>
              {breadcrumbs.map((c, i) => (
                <Fragment key={`${c.label}-${i}`}>
                  {i > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    {c.href ? (
                      <BreadcrumbLink asChild>
                        <Link href={c.href}>{c.label}</Link>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>{c.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        )}
        <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 max-md:[&>*]:flex-auto">{actions}</div>}
    </header>
  );
}

export function PageBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-4 pb-8 sm:px-6", className)}>{children}</div>;
}
