// Pedido de interrupção: mensagem curta que pede para não receber mais contato.
// Só frases inteiras contam, para não bloquear quem escreve "não quero agora, me chama semana que vem".
const STOP = /^\s*(parar|pare|sair|stop|cancelar|descadastrar|remover|n[aã]o quero( mais)?( receber)?( mensagens?)?|n[aã]o tenho interesse|n[aã]o me mande mais( mensagens?)?)\s*[.!]*\s*$/i;

export const isOptOut = (text: string | null | undefined) => Boolean(text && STOP.test(text));
