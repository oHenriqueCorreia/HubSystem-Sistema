# Decisões de arquitetura (ADRs)

Formato curto: contexto → decisão → consequências.

## 0001 · Regra de negócio e autorização no banco
**Contexto:** haverá app nativo no futuro; esconder botões não protege dados.
**Decisão:** permissões, escopos e invariantes vivem em RLS, triggers e RPCs no Postgres; o Next.js valida (Zod) e checa permissão para dar mensagens claras, mas a garantia é do banco.
**Consequências:** o app nativo reaproveita tudo usando o mesmo Supabase. Testes pgTAP cobrem as regras de acesso.

## 0002 · Lead = empresa; negócio = oportunidade; cliente = lead convertido
**Decisão:** `leads` guarda contatos; `deals` guarda etapa/valor/perda por funil; `clients.lead_id` é único. A conversão (RPC `convert_lead`) é transacional e não copia dados.
**Consequências:** o histórico (atividades, etiquetas, anexos) segue o mesmo `lead_id` antes e depois da conversão.

## 0003 · Sem `cacheComponents`; tudo dinâmico com RLS
**Contexto:** Next 16 traz Cache Components. Quase todo dado depende do usuário.
**Decisão:** desligado; leituras por requisição com o JWT do usuário.
**Consequências:** sem risco de vazar dados entre usuários via cache; desempenho garantido por índices, paginação e carregamento progressivo.

## 0004 · Tarefa é a unidade de "coisa a fazer"
**Decisão:** passos de cadência geram `tasks`; tarefas com horário aparecem na agenda; "atrasada" é calculado.
**Consequências:** uma fonte só para CRM, agenda e tarefas; nada a sincronizar.

## 0005 · Dinheiro em centavos; datas civis × instantes
**Decisão:** `bigint` em centavos; vencimento/competência em `date`; eventos em `timestamptz`, exibidos em America/Sao_Paulo.
**Consequências:** sem erro de arredondamento; parcelas somam exatamente o total (`splitInstallments`).

## 0006 · Permissões `módulo.recurso.ação` com escopo + exceções
**Decisão:** papéis com escopo own/team/all; `user_permission_overrides` libera ou bloqueia por usuário; papel Administrador é imutável; trava de "último administrador".

## 0007 · Financeiro pessoal × empresa
**Decisão:** coluna `scope` em contas, categorias, recorrências e lançamentos, com checks e trigger de coerência. Pessoal: só o dono pela tabela; o admin consulta por `admin_read_personal_finance`, que audita e é visível ao dono. A auditoria geral não registra lançamentos pessoais.

## 0008 · Tokens externos cifrados e fora da API
**Decisão:** refresh/access tokens do Google com AES-256-GCM (`TOKEN_ENCRYPTION_KEY`) em tabela sem políticas; só o servidor (chave secreta) lê.

## 0009 · Organização única com `organization_id` em tudo
**Decisão:** MVP com uma empresa, mas todas as tabelas e políticas filtram por `organization_id`. Multiempresa futura exige só telas de cadastro e convite por organização.

## 0010 · Tipos do banco escritos por módulo
**Contexto:** os tipos gerados dependem do banco aplicado.
**Decisão:** cada feature declara seus tipos de domínio; ao aplicar todas as migrations, regenerar `src/lib/supabase/database.types.ts` e tipar os clientes novamente é opcional.

## 0011 · Sem Docker no fluxo de desenvolvimento
**Decisão:** migrations e testes pgTAP rodam contra o projeto via `scripts/db.mjs` (sempre em transação com ROLLBACK para testes).
