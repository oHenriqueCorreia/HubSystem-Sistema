export type QuickReply = { id: string; shortcut: string; body: string };

/** Troca {nome} pelo primeiro nome e {empresa} pela empresa do contato. */
export function fillQuickReply(body: string, contact: { name?: string | null; company?: string | null }) {
  const first = (contact.name ?? "").trim().split(/\s+/)[0] ?? "";
  return body.replace(/\{nome\}/gi, first).replace(/\{empresa\}/gi, (contact.company ?? "").trim());
}

/** Atalho sendo digitado: só vale com a barra no começo e sem espaço depois dela. */
export function shortcutQuery(text: string) {
  const match = /^\/([a-z0-9_-]*)$/i.exec(text);
  return match ? match[1].toLowerCase() : null;
}

export const matchQuickReplies = (replies: QuickReply[], query: string) => replies.filter((r) => r.shortcut.startsWith(query)).slice(0, 8);
