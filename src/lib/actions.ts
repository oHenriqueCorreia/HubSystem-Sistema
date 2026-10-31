import "server-only";
import type { z } from "zod";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/dal";
import { mapDbError } from "@/lib/errors";
import { fail, type ActionResult } from "@/domain/shared/result";
import type { PermissionKey } from "@/domain/permissions";

type Ctx = { user: CurrentUser };

/**
 * Envolve uma Server Action: valida a entrada com Zod, exige sessão e
 * (opcionalmente) permissão, e converte exceções em ActionResult.
 * A RLS continua sendo a garantia final.
 */
export function defineAction<S extends z.ZodType, T>(
  opts: { schema: S; permission?: PermissionKey | PermissionKey[] },
  handler: (input: z.infer<S>, ctx: Ctx) => Promise<ActionResult<T>>,
) {
  return async (raw: unknown): Promise<ActionResult<T>> => {
    const parsed = opts.schema.safeParse(raw);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "_";
        (fieldErrors[key] ??= []).push(issue.message);
      }
      return fail("validation", "Revise os campos destacados.", fieldErrors);
    }

    const user = await getCurrentUser();
    if (!user) return fail("unauthenticated", "Sua sessão expirou. Entre novamente.");

    if (opts.permission) {
      const keys = Array.isArray(opts.permission) ? opts.permission : [opts.permission];
      if (!keys.some((k) => user.permissions[k])) {
        return fail("forbidden", "Você não tem permissão para esta ação.");
      }
    }

    try {
      return await handler(parsed.data, { user });
    } catch (error) {
      // Erros de redirect/notFound do Next precisam continuar subindo.
      if (error && typeof error === "object" && "digest" in error) throw error;
      const mapped = mapDbError(error as { code?: string; message?: string });
      if (mapped.code === "unknown") console.error("[action]", (error as Error)?.message ?? error);
      return fail(mapped.code, mapped.message);
    }
  };
}

/**
 * Lança o erro do Supabase para ser tratado por defineAction.
 * Use .single() quando a linha for obrigatória: ausência vira erro PGRST116.
 */
export function must<T>(res: { data: T; error: { code?: string; message: string } | null }): NonNullable<T> {
  if (res.error) throw res.error;
  if (res.data === null || res.data === undefined) {
    // RPCs que retornam void chegam como null: tratamos como sucesso vazio.
    return undefined as unknown as NonNullable<T>;
  }
  return res.data as NonNullable<T>;
}
