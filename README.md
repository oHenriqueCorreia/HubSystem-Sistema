# HubSystem

Gestão comercial, operacional e financeira para agência de sites e tráfego pago: CRM com funil Kanban e importação de planilhas, cadências de prospecção, tarefas, agenda (com Google Calendar), clientes e contratos, financeiro pessoal e empresarial, e dashboards.

- **Produção:** https://hubsystem-phi.vercel.app (o domínio `hubsystem.vercel.app` está em outra conta da Vercel; ao liberá-lo, aponte-o para este projeto e atualize `NEXT_PUBLIC_SITE_URL`)
- **Stack:** Next.js 16 (App Router) · React 19 · TypeScript estrito · Tailwind CSS 4 · shadcn/ui (Radix) · Supabase (Postgres 17, Auth, Storage, RLS) · React Hook Form + Zod · TanStack Query · dnd-kit · Recharts · Vitest · pgTAP
- **Arquitetura e decisões:** [docs/fase-0-arquitetura.md](docs/fase-0-arquitetura.md) e [docs/adr/](docs/adr/README.md)

## Módulos

| Área | Rotas | Destaques |
|---|---|---|
| Acesso | `/login`, `/recuperar-senha`, `/definir-senha`, `/auth/confirm` | Só por convite; senha ≥ 8 com letras e números |
| Meu dia | `/inicio` | Próxima ação, atrasadas, hoje, contatos e agenda do dia |
| CRM | `/crm/leads`, `/crm/funil`, `/crm/leads/[id]`, `/crm/importar`, `/crm/cadencias` | Filtros salvos, Kanban acessível por teclado, importação CSV/XLSX em 5 passos com deduplicação e desfazer, WhatsApp (wa.me), LGPD |
| Tarefas e agenda | `/tarefas`, `/agenda` | Lista, quadro, checklist, comentários; agenda dia/semana/mês com conflitos |
| Clientes | `/clientes`, `/contratos` | Conversão de lead preservando o histórico, contratos, anexos privados |
| Financeiro | `/financeiro/empresa`, `/financeiro/pessoal` | Contextos separados no banco, parcelas, recorrências, conciliação, fluxo de caixa |
| Dashboards | `/dashboards/comercial`, `/dashboards/financeiro` | Comparação com período anterior, previsão, tabela de dados em todo gráfico |
| Configurações | `/configuracoes/*` | Usuários, papéis × permissões, exceções por usuário, integrações, auditoria |

## Rodar localmente

```bash
npm install
cp .env.example .env.local   # preencha os valores (abaixo)
npm run dev                  # http://localhost:3000
```

### Variáveis de ambiente

| Variável | Onde obter | Uso |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | Público |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → API Keys → Publishable | Público |
| `NEXT_PUBLIC_SITE_URL` | `https://hubsystem.vercel.app` (ou `http://localhost:3000`) | Links de e-mail e OAuth |
| `SUPABASE_SECRET_KEY` | Supabase → API Keys → Secret keys | **Só servidor**: convites, bloqueio de sessão, Google |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud Console → Credenciais → OAuth (Aplicativo da Web) | Google Agenda |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` | Cifra os tokens do Google |
| `CRON_SECRET` | qualquer valor aleatório longo | Protege `/api/cron/*` (Vercel Cron) |
| `SUPABASE_DB_URL` | Supabase → Connect → Session pooler | Só para `npm run db:*` |

### Ativar convites e Google Agenda

1. Em **Supabase → Project Settings → API Keys**, copie uma chave **Secret** (`sb_secret_...`) do projeto HubSystem para `SUPABASE_SECRET_KEY`. Ela fica somente no servidor, nunca em variável `NEXT_PUBLIC_`.
2. No **Google Cloud**, selecione ou crie um projeto, ative a **Google Calendar API** e configure **Google Auth platform → Branding / Audience / Data Access**. O sistema solicita `openid`, `email` e `https://www.googleapis.com/auth/calendar.events`. Para um aplicativo **External** em teste, adicione a conta que conectará a agenda em **Audience → Test users**.
3. Em **Google Auth platform → Clients**, crie um cliente OAuth do tipo **Web application**. Em **Authorized redirect URIs**, cadastre exatamente `http://localhost:3000/api/google/oauth/callback` para testes locais e `https://hubsystem-phi.vercel.app/api/google/oauth/callback` para a produção atual. Se o domínio mudar, atualize esta URI e `NEXT_PUBLIC_SITE_URL` juntos.
4. Copie o ID e o segredo do cliente para `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env.local`. Configure as mesmas variáveis, além de `SUPABASE_SECRET_KEY`, `TOKEN_ENCRYPTION_KEY` e `CRON_SECRET`, nas variáveis de ambiente da hospedagem; depois faça um novo deploy. Use a mesma `TOKEN_ENCRYPTION_KEY` para não perder acesso aos tokens já cifrados.
5. Entre no HubSystem e acesse **Configurações → Integrações → Conectar Google Agenda**. Crie um evento de teste, use **Sincronizar agora** e confirme que ele aparece no Google Agenda. Para testar convites, use **Configurações → Usuários → Convidar**.

O cron diário em `vercel.json` requer `CRON_SECRET` na Vercel; a plataforma envia esse segredo automaticamente no cabeçalho de autorização.

Referências: [chaves do Supabase](https://supabase.com/docs/guides/getting-started/api-keys), [ativação da API Calendar](https://developers.google.com/workspace/guides/enable-apis), [consentimento OAuth](https://developers.google.com/workspace/guides/configure-oauth-consent), [OAuth para servidor web](https://developers.google.com/identity/protocols/oauth2/web-server) e [cron da Vercel](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## Banco de dados

As migrations ficam em `supabase/migrations/` (versionadas, nunca editadas depois de aplicadas). Três formas de aplicar:

1. `npm run db:migrate` — com `SUPABASE_DB_URL` no `.env.local` (não usa Docker).
2. **SQL Editor do Supabase:** cole `supabase/aplicar-no-sql-editor.sql` (gerado a partir das migrations; roda tudo numa transação).
3. Ferramenta MCP do Supabase.

Depois de aplicar, configure em **Authentication**:
- **URL Configuration:** Site URL `https://hubsystem-phi.vercel.app`; Redirect URLs `https://hubsystem-phi.vercel.app/**`, `https://hubsystem.vercel.app/**` e `http://localhost:3000/**`.
- **Sign In / Providers:** desligue *Allow new users to sign up* (acesso só por convite).
- **Primeiro acesso:** Authentication → Users → *Invite user* com o seu e-mail. O primeiro usuário vira **Administrador** automaticamente.

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

O projeto `hubsystem` na Vercel aponta para este repositório (`main`). Cadastre as variáveis acima em *Settings → Environment Variables*. O cron diário (`vercel.json`) sincroniza o Google Agenda.
