import { z } from "zod";

export const emailSchema = z
  .string({ error: "Informe o e-mail." })
  .trim()
  .toLowerCase()
  .min(1, "Informe o e-mail.")
  .pipe(z.email("Informe um e-mail válido, como nome@empresa.com.br."));

// Mesma regra configurada no Supabase Auth (mínimo 8, letras e números).
export const passwordSchema = z
  .string()
  .min(8, "A senha precisa ter pelo menos 8 caracteres.")
  .max(72, "A senha pode ter no máximo 72 caracteres.")
  .regex(/[A-Za-z]/, "Inclua pelo menos uma letra.")
  .regex(/\d/, "Inclua pelo menos um número.");

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Informe a senha."),
  next: z.string().optional(),
  // Manter conectado neste aparelho (padrão: sim).
  remember: z.boolean().default(false),
});

export const resetRequestSchema = z.object({ email: emailSchema });

export const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "As senhas não são iguais." });

/** Só aceita caminhos internos para evitar redirecionamento aberto. */
export function safeNext(next: string | null | undefined, fallback = "/inicio"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
