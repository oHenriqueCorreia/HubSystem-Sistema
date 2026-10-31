import Image from "next/image";
import { cn } from "cn";

/** Arquivos oficiais da identidade visual. A imagem preserva o desenho e a tipografia da marca. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-block size-8 shrink-0", className)} aria-hidden="true">
      <Image src="/brand/symbol-light.png" alt="" fill sizes="32px" className="object-contain dark:hidden" />
      <Image src="/brand/symbol-dark.png" alt="" fill sizes="32px" className="hidden object-contain dark:block" />
    </span>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-block h-12 w-44 shrink-0", className)}>
      <Image src="/brand/logo-light.png" alt="Hub System" fill sizes="176px" priority className="object-contain dark:hidden" />
      <Image src="/brand/logo-dark.png" alt="Hub System" fill sizes="176px" priority className="hidden object-contain dark:block" />
    </span>
  );
}
