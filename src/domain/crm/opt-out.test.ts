import { describe, expect, it } from "vitest";
import { isOptOut } from "./opt-out";

describe("pedido de interrupção", () => {
  it("reconhece pedidos claros", () => {
    for (const t of ["PARAR", "sair", "Não quero mais receber mensagens.", "nao tenho interesse", "Stop!", "Não me mande mais mensagens"]) expect(isOptOut(t)).toBe(true);
  });
  it("não bloqueia conversa normal", () => {
    for (const t of ["Não quero agora, me chama semana que vem", "Quero parar de perder clientes", "pode sair o orçamento hoje?", "", null]) expect(isOptOut(t)).toBe(false);
  });
});
