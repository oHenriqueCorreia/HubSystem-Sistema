import { describe, expect, it } from "vitest";
import { baseMime, checkOutgoingMedia, isOutgoingPath, outgoingPath } from "./media";

const ORG = "0f1fb8d3-99c2-4b1b-a130-38b064df2863";
const FILE = "1a2b3c4d-99c2-4b1b-a130-38b064df2863";

describe("checkOutgoingMedia", () => {
  it("classifica os tipos aceitos", () => {
    expect(checkOutgoingMedia({ mime: "image/png", size: 10, provider: "cloud" })).toEqual({ ok: true, kind: "image" });
    expect(checkOutgoingMedia({ mime: "video/mp4", size: 10, provider: "waha" })).toEqual({ ok: true, kind: "video" });
    expect(checkOutgoingMedia({ mime: "audio/ogg; codecs=opus", size: 10, provider: "cloud" })).toEqual({ ok: true, kind: "audio" });
    expect(checkOutgoingMedia({ mime: "application/pdf", size: 10, provider: "cloud" })).toEqual({ ok: true, kind: "document" });
  });

  it("áudio do navegador só vai pelo QR Code", () => {
    expect(checkOutgoingMedia({ mime: "audio/webm;codecs=opus", size: 10, provider: "waha" })).toEqual({ ok: true, kind: "audio" });
    expect(checkOutgoingMedia({ mime: "audio/webm;codecs=opus", size: 10, provider: "cloud" }).ok).toBe(false);
  });

  it("recusa tipo perigoso, arquivo vazio e arquivo grande", () => {
    expect(checkOutgoingMedia({ mime: "text/html", size: 10, provider: "waha" }).ok).toBe(false);
    expect(checkOutgoingMedia({ mime: "application/x-msdownload", size: 10, provider: "waha" }).ok).toBe(false);
    expect(checkOutgoingMedia({ mime: "image/png", size: 0, provider: "waha" }).ok).toBe(false);
    expect(checkOutgoingMedia({ mime: "image/png", size: 6 * 1024 * 1024, provider: "waha" }).ok).toBe(false);
  });

  it("limpa o tipo", () => {
    expect(baseMime("Audio/Ogg; codecs=opus")).toBe("audio/ogg");
  });
});

describe("caminho do arquivo enviado", () => {
  it("só vale dentro da própria organização", () => {
    const path = outgoingPath(ORG, FILE);
    expect(isOutgoingPath(path, ORG)).toBe(true);
    expect(isOutgoingPath(path, FILE)).toBe(false);
    expect(isOutgoingPath(`${ORG}/enviados/../outra/${FILE}`, ORG)).toBe(false);
    expect(isOutgoingPath(`${ORG}/${ORG}/mensagem`, ORG)).toBe(false);
  });
});
