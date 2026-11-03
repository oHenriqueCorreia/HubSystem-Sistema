import { describe, expect, it } from "vitest";
import { fillQuickReply, matchQuickReplies, shortcutQuery } from "./quick-replies";

describe("respostas rápidas", () => {
  it("preenche nome e empresa", () => {
    expect(fillQuickReply("Oi {nome}, tudo bem na {empresa}?", { name: "Ana Souza", company: "Loja X" })).toBe("Oi Ana, tudo bem na Loja X?");
  });

  it("não deixa a variável aparecer quando falta o dado", () => {
    expect(fillQuickReply("Oi {nome}! {EMPRESA}", { name: null, company: undefined })).toBe("Oi ! ");
  });

  it("reconhece o atalho só no começo e sem espaço", () => {
    expect(shortcutQuery("/")).toBe("");
    expect(shortcutQuery("/Boas")).toBe("boas");
    expect(shortcutQuery("/boas tardes")).toBeNull();
    expect(shortcutQuery("olá /boas")).toBeNull();
  });

  it("filtra pelo começo do atalho", () => {
    const replies = [
      { id: "1", shortcut: "boas", body: "a" },
      { id: "2", shortcut: "preco", body: "b" },
    ];
    expect(matchQuickReplies(replies, "b").map((r) => r.id)).toEqual(["1"]);
    expect(matchQuickReplies(replies, "")).toHaveLength(2);
  });
});
