// Dados exibidos nas páginas públicas (Política de Privacidade, Termos e Exclusão de dados).
export const LEGAL = {
  company: "Henrique Correia LTDA",
  product: "Hub System",
  email: "henriquedsgn7@gmail.com",
  updated: "1º de novembro de 2026",
} as const;

export const LEGAL_PAGES = [
  { href: "/privacidade", label: "Privacidade" },
  { href: "/termos", label: "Termos de uso" },
  { href: "/exclusao-de-dados", label: "Exclusão de dados" },
] as const;

export const mailto = (subject: string) => `mailto:${LEGAL.email}?subject=${encodeURIComponent(subject)}`;
