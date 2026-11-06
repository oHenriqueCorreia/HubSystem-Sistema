import { describe, expect, it } from "vitest";
import { mapDbError } from "./errors";

describe("mapDbError", () => {
  it("mostra o motivo da trava de acesso", () => {
    const res = mapDbError({ code: "42501", hint: "self_access", message: "Você não pode alterar o seu próprio acesso. Peça a um administrador." });
    expect(res).toEqual({ code: "forbidden", message: "Você não pode alterar o seu próprio acesso. Peça a um administrador." });
  });

  it("não repassa a mensagem em inglês da RLS", () => {
    const res = mapDbError({ code: "42501", message: 'new row violates row-level security policy for table "leads"' });
    expect(res).toEqual({ code: "forbidden", message: "Você não tem permissão para esta ação." });
  });
});
