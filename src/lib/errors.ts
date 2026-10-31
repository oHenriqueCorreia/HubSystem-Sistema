import type { ActionErrorCode } from "@/domain/shared/result";

type PgLikeError = { code?: string; message?: string; hint?: string; details?: string } | null | undefined;

/**
 * Traduz erros do PostgREST/Postgres em mensagens para a pessoa usuária.
 * Mensagens de regra de negócio (P0001) já vêm em português do banco.
 */
export function mapDbError(error: PgLikeError): { code: ActionErrorCode; message: string } {
  if (!error) return { code: "unknown", message: "Algo deu errado. Tente novamente." };

  switch (error.code) {
    case "42501":
      return { code: "forbidden", message: "Você não tem permissão para esta ação." };
    case "P0001":
      return { code: "business_rule", message: error.message ?? "Operação não permitida." };
    case "P0002":
    case "PGRST116":
      return { code: "not_found", message: "Registro não encontrado. Ele pode ter sido excluído." };
    case "23505":
      return { code: "conflict", message: "Já existe um registro com esses dados." };
    case "23503":
      return { code: "conflict", message: "Este registro está ligado a outros e não pode ser alterado assim." };
    case "23514":
    case "22P02":
    case "23502":
      return { code: "validation", message: "Algum dado está em formato inválido. Revise os campos." };
    default:
      if (error.message?.toLowerCase().includes("fetch failed")) {
        return { code: "network", message: "Sem conexão com o servidor. Verifique sua internet e tente novamente." };
      }
      return { code: "unknown", message: "Algo deu errado. Tente novamente." };
  }
}
