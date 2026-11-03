# HubSystem

Gestão comercial, operacional e financeira para agência de sites e tráfego pago, multiempresa: CRM com funil configurável, central de atendimento do WhatsApp (API oficial), cadências automáticas, tarefas com etiquetas e quadro personalizável, agenda sincronizada com o Google, anúncios (Meta Ads e Google Ads), clientes e contratos, financeiro pessoal e empresarial, notificações e dashboards.

- **Produção:** https://hubsystem-phi.vercel.app (o domínio `hubsystem.vercel.app` está em outra conta da Vercel; ao liberá-lo, aponte-o para este projeto e atualize `NEXT_PUBLIC_SITE_URL`)
- **Stack:** Next.js 16 (App Router) · React 19 · TypeScript estrito · Tailwind CSS 4 · shadcn/ui (Radix) · Supabase (Postgres 17, Auth, Storage, RLS) · React Hook Form + Zod · dnd-kit · Recharts · Vitest · pgTAP · Web Push
- **Arquitetura e decisões:** [docs/fase-0-arquitetura.md](docs/fase-0-arquitetura.md) e [docs/adr/](docs/adr/README.md)
- **Configuração das integrações, crons, permissões e solução de problemas:** [docs/integracoes.md](docs/integracoes.md)
- **Prospectador local com Docker sob demanda:** [docs/prospectador-local.md](docs/prospectador-local.md)

## Módulos

| Área | Rotas | Destaques |
|---|---|---|
| Acesso | `/login`, `/recuperar-senha`, `/definir-senha`, `/convite/[token]` | Só por convite (equipe ou ambiente próprio), token de uso único com validade, rate limiting |
| Início | `/inicio` | Relógio e saudação (Brasília), clima, passagem do dia, resumos de tarefas, reuniões, comercial e financeiro, alertas; blocos personalizáveis |
| Trabalho | `/tarefas`, `/agenda`, `/anuncios` | Etiquetas, quadro com colunas configuráveis, participantes, dependências, histórico; agenda com convidados, horários livres e Google; Meta Ads e Google Ads |
| Comercial | `/crm/leads`, `/crm/funil`, `/atendimento`, `/crm/cadencias`, `/clientes`, `/contratos` | Funil com etapas configuráveis, WhatsApp oficial ligado ao lead, cadências automáticas com consentimento |
| Financeiro | `/financeiro/empresa`, `/financeiro/pessoal` | Fixos e recorrentes (pausar, retomar, encerrar), subcategorias, parcelas, conciliação, fluxo de caixa |
| Dashboards | `/dashboards/comercial`, `/dashboards/financeiro` | Comparação com período anterior, previsão, tabela de dados em todo gráfico |
| Configurações | `/configuracoes/*` | Usuários e convites, papéis × permissões, etiquetas, expediente, integrações, auditoria |

## Rodar localmente

```bash
npm install
cp .env.example .env.local   # preencha os valores (abaixo)
npm run dev                  # http://localhost:3000
```

### Variáveis de ambiente

Todas estão comentadas em [.env.example](.env.example). Resumo:

| Variável | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL` | Públicas |
| `SUPABASE_SECRET_KEY` | **Só servidor**: convites, integrações, cron, rate limiting |
| `TOKEN_ENCRYPTION_KEY` | Cifra tokens do Google, Meta e WhatsApp (não trocar depois de em uso) |
| `CRON_SECRET` | Protege `/api/cron/*` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Agenda e Google Ads |
| `GOOGLE_ADS_DEVELOPER_TOKEN` (+ `GOOGLE_ADS_LOGIN_CUSTOMER_ID`) | Google Ads |
| `META_APP_ID` / `META_APP_SECRET` | Meta Ads e assinatura do webhook do WhatsApp |
| `WHATSAPP_VERIFY_TOKEN` | Verificação do webhook do WhatsApp |
| `SUPABASE_DB_URL` | Só para `npm run db:*` (URL do Session pooler com senha) |

### Ativar convites e Google Agenda

1. Em **Supabase → Project Settings → API Keys**, copie uma chave **Secret** (`sb_secret_...`) do projeto HubSystem para `SUPABASE_SECRET_KEY`. Ela fica somente no servidor, nunca em variável `NEXT_PUBLIC_`.
2. No **Google Cloud**, selecione ou crie um projeto, ative a **Google Calendar API** e configure **Google Auth platform → Branding / Audience / Data Access**. O sistema solicita `openid`, `email` e `https://www.googleapis.com/auth/calendar.events`. Para um aplicativo **External** em teste, adicione a conta que conectará a agenda em **Audience → Test users**.
3. Em **Google Auth platform → Clients**, crie um cliente OAuth do tipo **Web application**. Em **Authorized redirect URIs**, cadastre exatamente `http://localhost:3000/api/google/oauth/callback` para testes locais e `https://hubsystem-phi.vercel.app/api/google/oauth/callback` para a produção atual. Se o domínio mudar, atualize esta URI e `NEXT_PUBLIC_SITE_URL` juntos.
4. Copie o ID e o segredo do cliente para `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env.local`. Configure as mesmas variáveis, além de `SUPABASE_SECRET_KEY`, `TOKEN_ENCRYPTION_KEY` e `CRON_SECRET`, nas variáveis de ambiente da hospedagem; depois faça um novo deploy. Use a mesma `TOKEN_ENCRYPTION_KEY` para não perder acesso aos tokens já cifrados.
5. Entre no HubSystem e acesse **Configurações → Integrações → Conectar Google Agenda**. Crie um evento de teste, use **Sincronizar agora** e confirme que ele aparece no Google Agenda. Para testar convites, use **Configurações → Usuários → Convidar**.

Os crons diários em `vercel.json` (Google, anúncios e cadências) exigem `CRON_SECRET` na Vercel; a plataforma envia esse segredo automaticamente no cabeçalho de autorização.

Referências: [chaves do Supabase](https://supabase.com/docs/guides/getting-started/api-keys), [ativação da API Calendar](https://developers.google.com/workspace/guides/enable-apis), [consentimento OAuth](https://developers.google.com/workspace/guides/configure-oauth-consent), [OAuth para servidor web](https://developers.google.com/identity/protocols/oauth2/web-server) e [cron da Vercel](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## Banco de dados

As migrations ficam em `supabase/migrations/` (versionadas, nunca editadas depois de aplicadas). **O deploy de produção aplica as pendentes sozinho** antes de gerar o site (`scripts/vercel-build.mjs`); se uma falhar, o deploy para e a versão atual continua no ar. Para aplicar à mão: `npm run db:migrate`, com `SUPABASE_DB_URL` no `.env.local`.

Depois de aplicar, configure em **Authentication**:
- **URL Configuration:** Site URL `https://hubsystem-phi.vercel.app`; Redirect URLs `https://hubsystem-phi.vercel.app/**`, `https://hubsystem.vercel.app/**` e `http://localhost:3000/**`.
- **Sign In / Providers:** desligue *Allow new users to sign up* (acesso só por convite).
- **Novos acessos:** só por convite, em **Configurações → Usuários**. Conta sem convite é recusada pelo banco.

## Qualidade

```bash
npm run lint        # ESLint (zero avisos)
npm run typecheck   # tsc --noEmit
npm test            # Vitest: domínio (dinheiro, telefone, datas, importação com as planilhas reais, agenda, financeiro)
npm run db:test     # pgTAP: RLS e regras do banco (precisa de SUPABASE_DB_URL; sempre com ROLLBACK)
npm run build
```

## Segurança (resumo)

- Autorização = permissão `módulo.recurso.ação` com escopo próprio/equipe/todos, checada na Server Action **e** garantida pela **RLS** em todas as tabelas.
- Chave secreta e tokens do Google só no servidor; tokens cifrados (AES-256-GCM) numa tabela sem acesso pela API.
- Anexos em bucket privado, com tipo e tamanho validados no servidor e no bucket; download por URL assinada de 60 segundos.
- Auditoria imutável de permissões, exclusões, troca de responsável, valores financeiros, contratos, conversões e consultas do admin ao financeiro pessoal.
- LGPD: exportação de dados do titular e anonimização irreversível, ambas auditadas.

## Deploy (Vercel)

O projeto `hubsystem` na Vercel aponta para este repositório (`main`). Cadastre as variáveis acima em *Settings → Environment Variables*. Os crons (`vercel.json`) sincronizam o Google Agenda, os anúncios e executam as cadências. **Aplique as migrations antes de publicar uma versão nova**: o código depende delas.
