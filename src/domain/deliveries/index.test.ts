import { describe, expect, it } from "vitest";
import { baseMime, deliverySummary, deliveryType, feedbackType, isFeedbackPath } from ".";

describe("entregas", () => {
  it("resume pela situação mais urgente", () => {
    expect(deliverySummary([])).toBeNull();
    expect(deliverySummary([{ status: "aprovado" }])).toEqual({ status: "aprovado", label: "Aprovado" });
    expect(deliverySummary([{ status: "aprovado" }, { status: "aguardando" }])?.label).toBe("1 de 2 aguardando");
    expect(deliverySummary([{ status: "aprovado" }, { status: "aguardando" }, { status: "recusado" }])).toEqual({ status: "recusado", label: "1 de 3 recusadas" });
    expect(deliverySummary([{ status: "aprovado" }, { status: "aprovado" }])?.label).toBe("2 aprovadas");
  });

  it("reconhece só os formatos aceitos", () => {
    expect(deliveryType("image/png")?.kind).toBe("imagem");
    expect(deliveryType("video/quicktime")?.ext).toBe("mov");
    expect(deliveryType("application/pdf")?.kind).toBe("documento");
    expect(deliveryType("text/html")).toBeNull();
    expect(deliveryType("image/svg+xml")).toBeNull();
  });

  it("aceita o áudio gravado pelo navegador, com ou sem codec", () => {
    expect(baseMime("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(feedbackType("audio/webm;codecs=opus")?.kind).toBe("audio");
    expect(feedbackType("audio/mp4")?.ext).toBe("m4a");
    expect(feedbackType("application/pdf")).toBeNull();
  });

  it("recusa caminho de arquivo fora da entrega", () => {
    const prefix = "org/task/delivery";
    const ok = `${prefix}/3f2b8c1e-1111-4222-8333-444455556666.webm`;
    expect(isFeedbackPath(ok, prefix)).toBe(true);
    expect(isFeedbackPath(`outra/${ok}`, prefix)).toBe(false);
    expect(isFeedbackPath(`${prefix}/../../x.webm`, prefix)).toBe(false);
    expect(isFeedbackPath(`${prefix}/sub/3f2b8c1e-1111-4222-8333-444455556666.webm`, prefix)).toBe(false);
  });
});
