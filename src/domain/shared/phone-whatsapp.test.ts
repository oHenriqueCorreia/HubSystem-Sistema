import { describe, expect, it } from "vitest";
import { brPhoneVariants, waIdToE164 } from "./phone";

describe("telefones do WhatsApp", () => {
  it("gera as duas formas do celular brasileiro (com e sem o 9º dígito)", () => {
    expect(brPhoneVariants("+5548988123456")).toEqual(["+5548988123456", "+554888123456"]);
    expect(brPhoneVariants("+554888123456")).toEqual(["+554888123456", "+5548988123456"]);
  });

  it("não altera fixos nem números estrangeiros", () => {
    expect(brPhoneVariants("+554834561234")).toEqual(["+554834561234"]);
    expect(brPhoneVariants("+14155550123")).toEqual(["+14155550123"]);
  });

  it("converte o wa_id para E.164 com o 9º dígito", () => {
    expect(waIdToE164("554888123456")).toBe("+5548988123456");
    expect(waIdToE164("5548988123456")).toBe("+5548988123456");
    expect(waIdToE164("14155550123")).toBe("+14155550123");
    expect(waIdToE164("12")).toBeNull();
  });
});
