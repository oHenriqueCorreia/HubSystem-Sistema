# Configuração, integrações e implantação

Guia para o responsável técnico do Hub System. Cada integração funciona de forma independente: o sistema mostra "não configurado" e continua funcionando enquanto as variáveis de uma integração estiverem vazias.

## 1. Banco de dados (aplicar as migrations)

Todas as mudanças de estrutura ficam em `supabase/migrations/` e nunca são editadas depois de aplicadas. Escolha **uma** das formas:

| Forma | Quando usar |
|---|---|
| `npm run db:migrate` | `SUPABASE_DB_URL` preenchida com a URL do **Session pooler** (com a senha do banco) |
| SQL Editor do Supabase | Cole `supabase/aplicar-pendentes.sql` inteiro e clique em Run (roda numa transação; se algo falhar, nada é aplicado) |
| MCP do Supabase | Pelo Claude Code, aprovando cada `apply_migration` |

Depois de aplicar, rode os testes do banco (sempre com ROLLBACK, não alteram dados): `npm run db:test`.

**Reversão.** As migrations são aditivas. Para desfazer uma mudança, crie uma migration nova com o inverso (por exemplo, `drop policy …`). Não apague linhas de `supabase_migrations.schema_migrations` à mão.

## 2. E-mail de convite personalizado

O envio usa o SMTP já configurado no Supabase (Authentication → Emails → SMTP).

1. Supabase → Authentication → Email Templates → **Invite user**.
2. Assunto: `{{ .Data.inviter_name }} convidou você para o Hub System`.
3. Corpo: cole o conteúdo de `supabase/templates/convite.html`.
4. Authentication → URL Configuration: confira o **Site URL** (o logo do e-mail é carregado de `{{ .SiteURL }}/brand/logo-dark.png`).

O link do e-mail é do próprio Hub System (`/convite/<token>`): token de uso único, válido por 7 dias, guardado só como hash. O Supabase só envia HTML; o template já traz o endereço do link escrito por extenso para clientes de e-mail que bloqueiam botões.

## 3. Google Agenda

1. Google Cloud → APIs: ative **Google Calendar API**.
2. Google Auth platform → Data Access: escopos `calendar.events`, `calendar.freebusy` e `calendar.calendarlist.readonly` (além de `openid` e `email`).
3. Clients → Web application → URIs de redirecionamento:
   - `https://SEU-DOMINIO/api/google/oauth/callback`
   - `http://localhost:3000/api/google/oauth/callback`
4. Preencha `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `SUPABASE_SECRET_KEY`.
5. Cada usuário conecta a própria conta em **Configurações → Integrações**. Quem conectou antes desta versão vê o aviso “Reconectar com as novas permissões” (necessário para horários livres).

**Sincronização:** eventos e tarefas com prazo vão para o Google logo após serem salvos. O Google avisa o sistema a cada alteração por **notificações push** (`/api/google/webhook`, exige HTTPS público); o cron diário renova os canais e faz uma sincronização de segurança. Convidados por e-mail recebem convite e atualizações pelo próprio Google (`sendUpdates=all`).

## 4. Meta Ads e WhatsApp (mesmo app da Meta)

Em developers.facebook.com, crie um app do tipo **Empresa** e preencha `META_APP_ID` e `META_APP_SECRET`.

### Meta Ads
1. Adicione o produto **Marketing API** e o **Facebook Login para Empresas**.
2. URI de redirecionamento OAuth válida: `https://SEU-DOMINIO/api/ads/meta/callback`.
3. Permissões solicitadas: `ads_read` e `business_management` (somente leitura). Para uso por contas de terceiros, essas permissões passam pela **análise do app** da Meta.
4. Em **Trabalho → Anúncios**, clique em Conectar, escolha as contas que entram nos relatórios e crie alertas de saldo/gasto.

O token da Meta dura cerca de 60 dias; antes de expirar, o sistema avisa na central de notificações para reconectar.

### WhatsApp (Cloud API oficial)
1. Adicione o produto **WhatsApp** ao app e vincule a conta do WhatsApp Business (WABA) e o número.
2. Gerenciador de Negócios → Usuários do sistema: crie um usuário do sistema, dê acesso ao app e à WABA e gere um **token permanente** com `whatsapp_business_messaging` e `whatsapp_business_management`.
3. WhatsApp → Configuração → Webhook:
   - URL de retorno: `https://SEU-DOMINIO/api/whatsapp/webhook`
   - Token de verificação: o mesmo valor de `WHATSAPP_VERIFY_TOKEN`
   - Assine o campo **messages**.
4. No Hub System, **Comercial → Atendimento → Números conectados → Conectar número**: informe o ID do número, o ID da WABA e o token. O sistema valida na Meta antes de salvar e guarda o token cifrado.
5. Clique em **Sincronizar modelos** para trazer os modelos aprovados.

**Sobre QR Code.** A Cloud API não usa QR Code. O único caminho oficial com QR é o *Embedded Signup* no modo **Coexistência** (o número do app WhatsApp Business é migrado lendo um QR no próprio app). Ele exige que o app seja aprovado como **Tech Provider** da Meta. O sistema não automatiza o WhatsApp Web nem usa bibliotecas não oficiais, que violam os termos e podem banir o número.

**Regras de envio aplicadas pelo sistema:**
- Mensagem livre só até 24 horas após a última mensagem do cliente; depois, só modelos aprovados.
- Quem pede para parar (“parar”, “sair”, “não quero mais receber mensagens”…) tem os envios bloqueados.
- Quando o lead responde, a cadência ativa é pausada.
- Toda mensagem é única por `wamid`; envios do sistema têm `client_ref` único (cliques ou reprocessamentos repetidos não duplicam).

## 5. Google Ads

1. Na conta gerente (MCC): Ferramentas → **Central de API** → solicite o **token de desenvolvedor** (`GOOGLE_ADS_DEVELOPER_TOKEN`). Com acesso de teste, só contas de teste funcionam; para contas reais é preciso o acesso **Básico**.
2. Google Cloud: ative a **Google Ads API** no mesmo projeto do OAuth e adicione o escopo `https://www.googleapis.com/auth/adwords`.
3. URI de redirecionamento: `https://SEU-DOMINIO/api/ads/google/callback`.
4. Se as contas são acessadas por um MCC, informe `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.

O Google Ads não informa saldo nem limite de faturamento pela API de relatórios; a tela mostra “Indisponível pela API” em vez de inventar valores.

## 6. Clima e passagem do dia

- **Clima:** Open-Meteo (gratuita, sem chave). Cache de 30 minutos. Padrão: Araranguá/SC; cada usuário pode trocar a cidade ou usar a localização (pede permissão do navegador).
- **Passagem bíblica:** bible-api.com, tradução Almeida (domínio público). Uma por dia, sem repetir até percorrer a lista; cache de 1 dia. Sem a API, mostra a referência.

## 7. Tarefas agendadas (Vercel Cron)

| Rota | Horário (UTC) | O que faz |
|---|---|---|
| `/api/cron/google-sync` | 09:00 | Sincroniza agendas e renova canais push |
| `/api/cron/ads-sync` | 10:00 | Atualiza contas, campanhas, métricas e alertas de anúncios |
| `/api/cron/cadences` | 12:00 (09:00 em Brasília) | Executa etapas automáticas das cadências |

Todas exigem `CRON_SECRET`. No plano Hobby da Vercel, crons rodam no máximo uma vez por dia; para processar cadências com mais frequência, use o botão **Executar automações agora** ou um plano Pro.

## 8. Funções e permissões

| Papel | Resumo |
|---|---|
| Administrador | Tudo. Papel fixo; sempre existe ao menos um ativo |
| Gestor | CRM, atendimento, tarefas, agenda e dashboards de toda a equipe |
| Vendedor | Os próprios leads, conversas, tarefas e agenda |
| Atendente | Conversas e leads atribuídos, tarefas e agenda próprias |
| Financeiro | Financeiro da empresa |
| Colaborador | Tarefas e agenda próprias |
| Somente leitura | Consulta CRM, clientes, tarefas, agenda e anúncios |

Permissões podem ser ajustadas por papel (Configurações → Papéis) e por usuário (Usuários → Permissões). A interface esconde botões, mas a garantia é sempre a RLS no banco.

**Novos usuários.** Convite “Entrar na minha equipe” coloca a pessoa na sua organização com o papel escolhido. Convite “Ambiente próprio” cria uma organização nova e vazia para ela (funis, colunas e categorias padrão); ela não vê nada da sua.

## 9. Solução de problemas

| Sintoma | Causa provável |
|---|---|
| `npm run db:*` mostra “Erro:” vazio | `SUPABASE_DB_URL` não é a URL do Session pooler com senha |
| Convite não chega | SMTP do Supabase ou limite de e-mails por hora; use **Reenviar** depois |
| Google: “Reconectar com as novas permissões” | Conexão feita antes dos escopos de disponibilidade |
| Google não atualiza sozinho | `NEXT_PUBLIC_SITE_URL` sem HTTPS (push exige HTTPS público) |
| WhatsApp não recebe mensagens | Webhook não assinado no campo `messages` ou `META_APP_SECRET` diferente do app |
| Mensagem bloqueada por 24 h | Envie um modelo aprovado para reabrir a conversa |
| Anúncios “Acesso expirado” | Token da Meta (60 dias) ou acesso revogado no Google; clique em Reconectar |
