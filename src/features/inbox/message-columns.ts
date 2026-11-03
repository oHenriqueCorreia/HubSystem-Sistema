export const MESSAGE_COLUMNS = "id, direction, type, body, media_id, media_mime, media_name, status, error, author_id, important, created_at, wamid, client_ref, reply_to_wamid, sender_name, sender_jid, imported";

/** Quantas mensagens carregam de cada vez na conversa. */
export const MESSAGE_PAGE = 200;

export type Message = {
  id: string;
  direction: "entrada" | "saida" | "nota";
  type: string;
  body: string | null;
  media_id: string | null;
  media_mime: string | null;
  media_name: string | null;
  status: string;
  error: string | null;
  author_id: string | null;
  important: boolean;
  created_at: string;
  wamid: string | null;
  client_ref: string | null;
  reply_to_wamid: string | null;
  sender_name: string | null;
  sender_jid: string | null;
  imported: boolean;
};
