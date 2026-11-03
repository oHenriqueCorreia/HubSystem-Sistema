import { describe, expect, it } from "vitest";
import { bareMessageId, displayPhoneFromMe, messageIdFromResponse, parseWahaEvent, referralFromRaw, sessionNameFor, validWahaUrl } from "./waha";

const message = (payload: Record<string, unknown>) => ({ event: "message.any", session: "hub", payload });

describe("ids de mensagem", () => {
  it("reduz o id composto do webhook à cauda usada no envio", () => {
    expect(bareMessageId("true_5548999990000@c.us_3EB0ABC")).toBe("3EB0ABC");
    expect(bareMessageId("3EB0ABC")).toBe("3EB0ABC");
  });

  it("entende os formatos da resposta de envio", () => {
    expect(messageIdFromResponse({ id: "true_5548@c.us_ABC" })).toBe("ABC");
    expect(messageIdFromResponse({ id: { _serialized: "false_55@c.us_DEF" } })).toBe("DEF");
    expect(messageIdFromResponse({ id: { id: "GHI" } })).toBe("GHI");
    expect(messageIdFromResponse({ key: { id: "JKL" } })).toBe("JKL");
    expect(messageIdFromResponse({})).toBeNull();
  });
});

describe("parseWahaEvent", () => {
  it("lê mensagem recebida e coloca o 9º dígito do Brasil", () => {
    const e = parseWahaEvent(message({ id: "false_554899990000@c.us_ABC", from: "554899990000@c.us", to: "554800000000@c.us", fromMe: false, body: "Oi", timestamp: 1790000000, _data: { pushName: "Ana" } }));
    expect(e).toMatchObject({ kind: "message", wamid: "ABC", fromMe: false, phone: "+5548999990000", name: "Ana", type: "text", body: "Oi", media: null });
  });

  it("no eco do celular, o contato é o destinatário", () => {
    const e = parseWahaEvent(message({ id: "true_5548999990000@c.us_XYZ", from: "554800000000@c.us", to: "5548999990000@c.us", fromMe: true, body: "Olá" }));
    expect(e).toMatchObject({ kind: "message", fromMe: true, phone: "+5548999990000" });
  });

  it("resolve contato com id oculto (@lid) pela chave alternativa", () => {
    const e = parseWahaEvent(message({ id: "false_123@lid_ABC", from: "123@lid", fromMe: false, _data: { key: { remoteJidAlt: "5548999990000@s.whatsapp.net" } } }));
    expect(e).toMatchObject({ kind: "message", phone: "+5548999990000" });
  });

  it("ignora @lid sem telefone, grupos, estados e canais", () => {
    for (const from of ["123@lid", "120363@g.us", "status@broadcast", "120@newsletter"]) {
      expect(parseWahaEvent(message({ id: "false_x_ABC", from, fromMe: false })).kind).toBe("ignored");
    }
  });

  it("classifica a mídia pelo tipo do arquivo", () => {
    const base = { id: "false_554899990000@c.us_M", from: "554899990000@c.us", fromMe: false, hasMedia: true };
    const media = (mimetype: string, filename: string | null = null) => message({ ...base, media: { url: "https://waha/files/a", mimetype, filename } });
    expect(parseWahaEvent(media("image/jpeg"))).toMatchObject({ type: "image" });
    expect(parseWahaEvent(media("audio/ogg; codecs=opus"))).toMatchObject({ type: "audio" });
    expect(parseWahaEvent(media("video/mp4"))).toMatchObject({ type: "video" });
    expect(parseWahaEvent(media("application/pdf", "contrato.pdf"))).toMatchObject({ type: "document", media: { name: "contrato.pdf" } });
  });

  it("traduz confirmações de entrega e leitura", () => {
    const ack = (n: number) => parseWahaEvent({ event: "message.ack", payload: { id: "true_55@c.us_ABC", ack: n } });
    expect(ack(2)).toEqual({ kind: "ack", wamid: "ABC", status: "entregue" });
    expect(ack(3)).toEqual({ kind: "ack", wamid: "ABC", status: "lida" });
    expect(ack(-1)).toEqual({ kind: "ack", wamid: "ABC", status: "erro" });
    expect(ack(0).kind).toBe("ignored");
  });

  it("lê a situação da sessão", () => {
    expect(parseWahaEvent({ event: "session.status", me: { id: "554899990000@c.us", pushName: "Loja" }, payload: { status: "WORKING" } })).toEqual({ kind: "session", status: "WORKING", meId: "554899990000@c.us", meName: "Loja" });
  });

  it("não lança com lixo", () => {
    for (const lixo of [null, 1, "x", {}, { event: "message.any" }, { event: "message.any", payload: { from: 5 } }, { event: "outro", payload: {} }]) {
      expect(parseWahaEvent(lixo).kind).toBe("ignored");
    }
  });
});

describe("origem no anúncio", () => {
  it("extrai o anúncio da mensagem", () => {
    const r = referralFromRaw({ extendedTextMessage: { contextInfo: { externalAdReply: { sourceType: "ad", sourceId: "1202", ctwaClid: "abc", sourceUrl: "https://fb.me/x", title: "Promo" } } } });
    expect(r).toEqual({ source_type: "ad", source_id: "1202", source_url: "https://fb.me/x", headline: "Promo", body: null, ctwa_clid: "abc" });
  });

  it("mensagem comum não tem origem", () => {
    expect(referralFromRaw({ conversation: "oi" })).toBeNull();
    expect(referralFromRaw(null)).toBeNull();
  });
});

describe("configuração do servidor", () => {
  it("aceita só HTTPS público", () => {
    expect(validWahaUrl("https://waha.exemplo.com.br/")).toBe("https://waha.exemplo.com.br");
    expect(validWahaUrl("http://waha.exemplo.com.br")).toBeNull();
    expect(validWahaUrl("http://localhost:3030")).toBeNull();
    expect(validWahaUrl("https://192.168.0.10")).toBeNull();
    expect(validWahaUrl("https://169.254.169.254")).toBeNull();
    expect(validWahaUrl("nada")).toBeNull();
  });

  it("em desenvolvimento aceita o servidor local", () => {
    expect(validWahaUrl("http://localhost:3030", true)).toBe("http://localhost:3030");
  });

  it("gera nome de sessão válido e número de exibição", () => {
    expect(sessionNameFor("0f1fb8d3-99c2-4b1b-a130-38b064df2863")).toMatch(/^hub_[a-z0-9]{24}$/);
    expect(displayPhoneFromMe("554899990000:12@c.us")).toBe("+5548999990000");
    expect(displayPhoneFromMe(null)).toBe("");
  });
});
