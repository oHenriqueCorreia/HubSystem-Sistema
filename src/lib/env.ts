import { z } from "zod";

// Variáveis públicas: podem ir para o navegador.
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
  // Canais de suporte do passo a passo das integrações. Sem eles, os botões não aparecem.
  NEXT_PUBLIC_SUPPORT_WHATSAPP: z.string().regex(/^\+?\d{10,15}$/).optional(),
  NEXT_PUBLIC_SUPPORT_MEETING_URL: z.url().optional(),
});

// Referências literais para o bundler conseguir substituir no cliente.
export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
  NEXT_PUBLIC_SUPPORT_WHATSAPP: process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP?.replace(/[\s()-]/g, "") || undefined,
  NEXT_PUBLIC_SUPPORT_MEETING_URL: process.env.NEXT_PUBLIC_SUPPORT_MEETING_URL || undefined,
});
