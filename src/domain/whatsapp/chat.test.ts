import { describe, expect, it } from "vitest";
import { avatarColor, chatInitials, dayLabel, groupMessagesByDay, listTime, messagePreview, wahaReplyId } from "./chat";

describe("avatar", () => {
  it("a mesma pessoa sempre tem a mesma cor", () => {
    expect(avatarColor("Ana")).toBe(avatarColor("Ana"));
  });

  it("usa primeira e última palavra e ignora número", () => {
    expect(chatInitials("Ana Maria Souza")).toBe("AS");
    expect(chatInitials("ana")).toBe("A");
    expect(chatInitials("+55 48 9999")).toBe("");
  });
});

describe("datas da conversa", () => {
  const today = "2026-11-03";

  it("nomeia hoje e ontem no fuso de São Paulo", () => {
    expect(dayLabel("2026-11-03T12:00:00Z", today)).toBe("Hoje");
    expect(dayLabel("2026-11-03T01:00:00Z", today)).toBe("Ontem");
    expect(dayLabel("2026-10-20T15:00:00Z", today)).toBe("20 de outubro");
    expect(dayLabel("2025-10-20T15:00:00Z", today)).toContain("2025");
  });

  it("mostra hora hoje, Ontem e data antes", () => {
    expect(listTime("2026-11-03T13:05:00Z", today)).toBe("10:05");
    expect(listTime("2026-11-02T13:05:00Z", today)).toBe("Ontem");
    expect(listTime("2026-10-20T13:05:00Z", today)).toBe("20/10");
    expect(listTime("2025-10-20T13:05:00Z", today)).toBe("20/10/25");
  });

  it("agrupa em ordem, respeitando a virada do dia", () => {
    const groups = groupMessagesByDay([{ created_at: "2026-11-02T23:00:00Z" }, { created_at: "2026-11-03T02:00:00Z" }, { created_at: "2026-11-03T12:00:00Z" }], today);
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([["Ontem", 2], ["Hoje", 1]]);
  });
});

describe("prévia da mensagem", () => {
  it("usa o texto, ou o tipo quando é mídia", () => {
    expect(messagePreview({ type: "text", body: " Oi\n  tudo bem " })).toBe("Oi tudo bem");
    expect(messagePreview({ type: "image", body: null })).toBe("Foto");
    expect(messagePreview({ type: "audio", body: "" })).toBe("Áudio");
    expect(messagePreview({ type: "document", body: null, media_name: "contrato.pdf" })).toBe("contrato.pdf");
    expect(messagePreview(null)).toBe("");
  });
});

describe("citação", () => {
  it("monta o id no formato do WAHA", () => {
    expect(wahaReplyId(false, "5548@c.us", "ABC")).toBe("false_5548@c.us_ABC");
    expect(wahaReplyId(true, "5548@c.us", "ABC")).toBe("true_5548@c.us_ABC");
  });
});
