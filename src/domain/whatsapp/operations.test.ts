import { describe, expect, it } from "vitest";
import { actionSchema, matchesCondition } from "./automations";
import { buildConversionEvent, conversionExpired, hashPhone } from "./conversions";
import { formatOutcome, outcomeReason } from "./outcomes";

const event = { id: "e1", eventName: "Purchase", valueCents: 150000, contactE164: "+5548999990000", ctwaClid: "clid", provider: "cloud", eventTime: "2026-11-02T12:00:00Z" };

describe("condição da automação", () => {
  it("sem condição sempre vale", () => {
    expect(matchesCondition({}, {})).toBe(true);
  });

  it("palavra-chave ignora acento e maiúscula", () => {
    expect(matchesCondition({ keyword: "preço" }, { body: "Qual o PRECO?" })).toBe(true);
    expect(matchesCondition({ keyword: "preço" }, { body: "Bom dia" })).toBe(false);
    expect(matchesCondition({ keyword: "preço" }, { body: null })).toBe(false);
  });

  it("confere etapa e falta de responsável", () => {
    expect(matchesCondition({ stageId: "a" as string }, { stageId: "b" })).toBe(false);
    expect(matchesCondition({ noAssignee: true }, { assigneeId: "u1" })).toBe(false);
    expect(matchesCondition({ noAssignee: true }, { assigneeId: null })).toBe(true);
  });

  it("recusa ação desconhecida", () => {
    expect(actionSchema.safeParse({ type: "apagar_tudo" }).success).toBe(false);
    expect(actionSchema.safeParse({ type: "enviar_texto", body: "  " }).success).toBe(false);
  });
});

describe("conversão para a Meta", () => {
  it("API oficial com clique vai direto ao anúncio", () => {
    const e = buildConversionEvent(event, "123456");
    expect(e).toMatchObject({ action_source: "business_messaging", messaging_channel: "whatsapp", user_data: { whatsapp_business_account_id: "123456", ctwa_clid: "clid" }, custom_data: { currency: "BRL", value: 1500 } });
  });

  it("QR Code nunca usa o caminho que exige a API oficial e não manda telefone aberto", () => {
    const e = buildConversionEvent({ ...event, provider: "waha" }, "123456");
    expect(e).toMatchObject({ action_source: "chat", user_data: { ph: [hashPhone("+5548999990000")] } });
    expect(JSON.stringify(e)).not.toContain("5548999990000");
  });

  it("sem clique nem telefone, não há o que enviar", () => {
    expect(buildConversionEvent({ ...event, provider: "waha", contactE164: null }, null)).toBeNull();
  });

  it("evento com mais de 7 dias expira", () => {
    const at = new Date("2026-11-02T12:00:00Z").getTime();
    expect(conversionExpired("2026-10-30T12:00:00Z", at)).toBe(false);
    expect(conversionExpired("2026-10-20T12:00:00Z", at)).toBe(true);
  });
});

describe("motivo de encerramento", () => {
  it("guarda e recupera o motivo", () => {
    expect(formatOutcome("Preço", " caro ")).toBe("Preço: caro");
    expect(formatOutcome("Preço", "")).toBe("Preço");
    expect(outcomeReason("Preço: caro")).toBe("Preço");
    expect(outcomeReason(null)).toBeNull();
  });
});
