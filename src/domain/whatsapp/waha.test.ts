import { describe, expect, it } from "vitest";
import { bareMessageId, chatKind, displayPhoneFromMe, historyItem, messageIdFromResponse, parseWahaEvent, phoneOfJid, referralFromRaw, scopedWamid, sessionNameFor, unscopedWamid, validWahaUrl } from "./waha";

const message = (payload: Record<string, unknown>) => ({ event: "message.any", session: "hub", payload });

describe("ids de mensagem", () => {
  it("reduz o id composto do webhook à cauda usada no envio", () => {
    expect(bareMessageId("true_5548999990000@c.us_3EB0ABC")).toBe("3EB0ABC");
    expect(bareMessageId("3EB0ABC")).toBe("3EB0ABC");
  });

  it("em grupo, não confunde o id da mensagem com quem escreveu", () => {
    expect(bareMessageId("false_120363000@g.us_3EB0ABC_5548999990000@c.us")).toBe("3EB0ABC");
    expect(bareMessageId("true_120363000@g.us_3EB0ABC")).toBe("3EB0ABC");
  });

  it("cada número guarda a própria cópia da mensagem de grupo", () => {
    const a = scopedWamid("11111111-aaaa-4aaa-aaaa-aaaaaaaaaaaa", "ABC");
    const b = scopedWamid("22222222-aaaa-4aaa-aaaa-aaaaaaaaaaaa", "ABC");
    expect(a).not.toBe(b);
    expect(unscopedWamid(a)).toBe("ABC");
    expect(unscopedWamid("ABC")).toBe("ABC");
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

  it("lê mensagem de grupo com quem escreveu", () => {
    const e = parseWahaEvent(message({ id: "false_120363000@g.us_ABC_5548999990000@c.us", from: "120363000@g.us", participant: "5548999990000@c.us", fromMe: false, body: "Bom dia", timestamp: 1790000000, _data: { pushName: "Ana", key: { remoteJid: "120363000@g.us", participant: "5548999990000@c.us" }, message: { conversation: "Bom dia" } } }));
    expect(e).toMatchObject({ kind: "group_message", wamid: "ABC", groupJid: "120363000@g.us", senderJid: "5548999990000@c.us", senderName: "Ana", fromMe: false, type: "text", body: "Bom dia" });
  });

  it("no grupo, eco do celular sem to acha o grupo pela chave", () => {
    const e = parseWahaEvent(message({ id: "true_120363000@g.us_XYZ", from: "120363000@g.us", fromMe: true, body: "Oi", _data: { key: { remoteJid: "120363000@g.us", fromMe: true } } }));
    expect(e).toMatchObject({ kind: "group_message", fromMe: true, groupJid: "120363000@g.us", senderJid: null });
  });

  it("reação em grupo não vira mensagem", () => {
    const e = parseWahaEvent(message({ id: "false_120363000@g.us_ABC_55@c.us", from: "120363000@g.us", fromMe: false, _data: { key: { remoteJid: "120363000@g.us" }, message: { reactionMessage: { text: "👍" } } } }));
    expect(e.kind).toBe("ignored");
  });

  it("confirmação de grupo avisa que é de grupo", () => {
    expect(parseWahaEvent({ event: "message.ack", payload: { id: "true_120363000@g.us_ABC", ack: 3 } })).toMatchObject({ kind: "ack", wamid: "ABC", group: true });
    expect(parseWahaEvent({ event: "message.ack", payload: { id: "true_55@c.us_ABC", ack: 3 } })).toMatchObject({ kind: "ack", group: false });
  });

  it("ignora @lid sem telefone, estados e canais", () => {
    for (const from of ["123@lid", "status@broadcast", "120@newsletter"]) {
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
    expect(ack(2)).toEqual({ kind: "ack", wamid: "ABC", status: "entregue", group: false });
    expect(ack(3)).toEqual({ kind: "ack", wamid: "ABC", status: "lida", group: false });
    expect(ack(-1)).toEqual({ kind: "ack", wamid: "ABC", status: "erro", group: false });
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

describe("histórico", () => {
  it("classifica os endereços", () => {
    expect(chatKind("120363000@g.us")).toBe("grupo");
    expect(chatKind("5548999990000@c.us")).toBe("contato");
    expect(chatKind("123@lid")).toBe("contato");
    expect(chatKind("status@broadcast")).toBe("ignorar");
    expect(chatKind("120@newsletter")).toBe("ignorar");
    expect(phoneOfJid("554899990000@s.whatsapp.net")).toBe("+5548999990000");
    expect(phoneOfJid("123@lid")).toBeNull();
    expect(phoneOfJid(null)).toBeNull();
  });

  it("mensagem de texto de contato", () => {
    expect(historyItem({ id: "false_5548@c.us_ABC", timestamp: 1790000000, fromMe: false, body: "Oi", _data: { message: { conversation: "Oi" } } }, null)).toMatchObject({ wamid: "ABC", direction: "entrada", type: "text", body: "Oi", sender_name: null });
  });

  it("foto antiga guarda o tipo e a legenda, sem baixar", () => {
    expect(historyItem({ id: "true_5548@c.us_ABC", timestamp: 1790000000, fromMe: true, body: "Legenda", hasMedia: true, _data: { message: { imageMessage: { mimetype: "image/jpeg" } } } }, null)).toMatchObject({ direction: "saida", type: "image", body: "Legenda" });
  });

  it("abre mensagem temporária e documento com legenda", () => {
    expect(historyItem({ id: "false_5548@c.us_A", timestamp: 1, fromMe: false, _data: { message: { ephemeralMessage: { message: { videoMessage: {} } } } } }, null)?.type).toBe("video");
    expect(historyItem({ id: "false_5548@c.us_B", timestamp: 1, fromMe: false, _data: { message: { documentWithCaptionMessage: { message: { documentMessage: {} } } } } }, null)?.type).toBe("document");
  });

  it("deixa de fora reação e aviso de sistema", () => {
    expect(historyItem({ id: "false_5548@c.us_A", timestamp: 1, fromMe: false, _data: { message: { reactionMessage: {} } } }, null)).toBeNull();
    expect(historyItem({ id: "false_5548@c.us_B", timestamp: 1, fromMe: false, _data: { message: { protocolMessage: {} } } }, null)).toBeNull();
  });

  it("em grupo, guarda quem escreveu e o prefixo do número", () => {
    const item = historyItem({ id: "false_120363000@g.us_ABC_5548@c.us", timestamp: 1790000000, fromMe: false, body: "Oi", participant: "5548@c.us", replyTo: { id: "DEF" }, _data: { pushName: "Ana", message: { conversation: "Oi" } } }, "11111111-aaaa-4aaa-aaaa-aaaaaaaaaaaa");
    expect(item).toMatchObject({ wamid: "11111111:ABC", sender_name: "Ana", sender_jid: "5548@c.us", reply_to: "11111111:DEF" });
  });

  it("guarda o telefone alternativo de quem tem id oculto", () => {
    expect(historyItem({ id: "false_123@lid_A", timestamp: 1, fromMe: false, body: "Oi", _data: { key: { remoteJidAlt: "5548@s.whatsapp.net" } } }, null)?.alt).toBe("5548@s.whatsapp.net");
  });
});
