# HubSystem

Gestão comercial, operacional e financeira para agência de sites e tráfego pago: CRM com funil Kanban e importação de planilhas, cadências de prospecção, tarefas, agenda (com Google Calendar), clientes e contratos, financeiro pessoal e empresarial, e dashboards.

- **Produção:** https://hubsystem.vercel.app
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

No Google Cloud, cadastre a URI de redirecionamento `https://hubsystem.vercel.app/api/google/oauth/callback` (e a de localhost, se for testar).

## Banco de dados

As migrations ficam em `supabase/migrations/` (versionadas, nunca editadas depois de aplicadas). Três formas de aplicar:

1. `npm run db:migrate` — com `SUPABASE_DB_URL` no `.env.local` (não usa Docker).
2. **SQL Editor do Supabase:** cole `supabase/aplicar-no-sql-editor.sql` (gerado a partir das migrations; roda tudo numa transação).
3. Ferramenta MCP do Supabase.

Depois de aplicar, configure em **Authentication**:
- **URL Configuration:** Site URL `https://hubsystem.vercel.app`; Redirect URLs `https://hubsystem.vercel.app/**` e `http://localhost:3000/**`.
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
