import { describe, expect, it } from "vitest";
import { driveDownloadUrl, driveFileId, formatProblem, isAuthError, metaErrorMessage, publishProblem } from "./index";

describe("formatos", () => {
  it("post leva imagem; vídeo e reels levam um vídeo", () => {
    expect(formatProblem("post", { images: 2, videos: 0, caption: "" })).toBeNull();
    expect(formatProblem("post", { images: 0, videos: 1, caption: "" })).not.toBeNull();
    expect(formatProblem("reels", { images: 0, videos: 1, caption: "" })).toBeNull();
    expect(formatProblem("reels", { images: 0, videos: 0, caption: "" })).not.toBeNull();
    expect(formatProblem("video", { images: 1, videos: 1, caption: "" })).not.toBeNull();
  });
});

describe("link do Google Drive", () => {
  it("entende os formatos comuns", () => {
    expect(driveFileId("https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=sharing")).toBe("1AbCdEfGhIjKlMn");
    expect(driveFileId("https://drive.google.com/open?id=1AbCdEfGhIjKlMn")).toBe("1AbCdEfGhIjKlMn");
    expect(driveFileId("https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMn")).toBe("1AbCdEfGhIjKlMn");
  });

  it("recusa outros endereços, sem deixar buscar site interno", () => {
    expect(driveFileId("https://exemplo.com/file/d/1AbCdEfGhIjKlMn/view")).toBeNull();
    expect(driveFileId("http://drive.google.com/file/d/1AbCdEfGhIjKlMn/view")).toBeNull();
    expect(driveFileId("https://drive.google.com.evil.com/file/d/1AbCdEfGhIjKlMn")).toBeNull();
    expect(driveFileId("não é link")).toBeNull();
    expect(driveFileId("https://drive.google.com/drive/folders/abc")).toBeNull();
  });

  it("monta o link de download com o id", () => {
    expect(driveDownloadUrl("abc123")).toContain("id=abc123");
  });
});

describe("limites das plataformas", () => {
  const ok = { images: 1, videos: 0, caption: "Legenda" };

  it("Instagram exige mídia; Facebook aceita só texto", () => {
    expect(publishProblem("instagram", { images: 0, videos: 0, caption: "Só texto" })).not.toBeNull();
    expect(publishProblem("facebook", { images: 0, videos: 0, caption: "Só texto" })).toBeNull();
    expect(publishProblem("facebook", { images: 0, videos: 0, caption: "  " })).not.toBeNull();
  });

  it("não mistura foto e vídeo nem aceita dois vídeos", () => {
    expect(publishProblem("instagram", { images: 1, videos: 1, caption: "" })).not.toBeNull();
    expect(publishProblem("facebook", { images: 0, videos: 2, caption: "" })).not.toBeNull();
  });

  it("confere carrossel, legenda e hashtags do Instagram", () => {
    expect(publishProblem("instagram", ok)).toBeNull();
    expect(publishProblem("instagram", { ...ok, images: 11 })).not.toBeNull();
    expect(publishProblem("instagram", { ...ok, caption: "x".repeat(2201) })).not.toBeNull();
    expect(publishProblem("instagram", { ...ok, caption: Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(" ") })).not.toBeNull();
  });
});

describe("erros da Meta", () => {
  it("token expirado pede reconexão", () => {
    expect(isAuthError(190)).toBe(true);
    expect(metaErrorMessage(190, "x")).toContain("Reconecte");
  });

  it("outros erros mostram o detalhe", () => {
    expect(metaErrorMessage(100, "Invalid image")).toContain("Invalid image");
    expect(metaErrorMessage(undefined, undefined)).toBe("A Meta recusou a publicação.");
  });
});
