import "server-only";
import { z } from "zod";

// Segredos: só existem no servidor. Importar este arquivo num Client Component
// quebra o build (server-only).
const serverSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(20),
});

let cached: z.infer<typeof serverSchema> | undefined;

export function serverEnv() {
  cached ??= serverSchema.parse({ SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY });
  return cached;
}
