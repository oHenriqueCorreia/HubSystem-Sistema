-- =============================================================================
-- Fase 11 · Anúncios (Meta Ads e Google Ads) e central de notificações
-- =============================================================================
-- * Conexões externas guardam tokens cifrados no servidor (AES-GCM) numa
--   tabela sem acesso pela API; a interface lê só o estado via RPC.
-- * Métricas ficam por dia (ad_insights_daily) para relatórios por dia,
--   semana, mês ou período sem consultar a API a cada clique.
-- * Notificações têm chave de deduplicação: o mesmo alerta não se repete.
-- =============================================================================

insert into public.permissions (key, module, label, position) values
  ('ads.read', 'Anúncios', 'Ver contas, campanhas e relatórios de anúncios', 85),
  ('ads.manage', 'Anúncios', 'Conectar contas de anúncios e configurar alertas', 86)
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key, scope)
select r.id, p.key, 'all'
from public.roles r
cross join (values ('ads.read'), ('ads.manage')) as p(key)
where r.key = 'admin'
on conflict do nothing;
insert into public.role_permissions (role_id, permission_key, scope)
select r.id, 'ads.read', 'all' from public.roles r where r.key in ('gestor', 'leitura')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Conexões (somente servidor)
-- -----------------------------------------------------------------------------
create table public.integration_connections (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  provider          text not null check (provider in ('meta_ads', 'google_ads')),
  connected_by      uuid references public.profiles (id) on delete set null,
  external_user     text not null default '',
  scopes            text[] not null default '{}',
  token_enc         text not null,
  refresh_token_enc text,
  expires_at        timestamptz,
  status            text not null default 'ativa' check (status in ('ativa', 'erro', 'expirada', 'revogada')),
  last_synced_at    timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, provider)
);
alter table public.integration_connections enable row level security;
revoke all on public.integration_connections from authenticated, anon;

create or replace function public.my_ad_connections()
returns table (provider text, external_user text, status text, last_synced_at timestamptz, last_error text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.provider, c.external_user, c.status, c.last_synced_at, c.last_error, c.expires_at
  from public.integration_connections c
  where c.organization_id = private.org_id() and private.has_perm('ads.read');
$$;
revoke execute on function public.my_ad_connections() from public, anon;
grant execute on function public.my_ad_connections() to authenticated;

-- -----------------------------------------------------------------------------
-- Contas, campanhas e métricas diárias
-- -----------------------------------------------------------------------------
create table public.ad_accounts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  provider              text not null check (provider in ('meta_ads', 'google_ads')),
  external_id           text not null,
  name                  text not null,
  currency              text not null default 'BRL',
  status                text,
  is_selected           boolean not null default false,
  -- Valores informados pela API (null = a API não fornece para esta conta).
  balance_cents         bigint,
  spend_cap_cents       bigint,
  amount_spent_cents    bigint,
  -- Alertas configurados pelo usuário.
  alert_balance_below_cents  bigint check (alert_balance_below_cents >= 0),
  alert_daily_spend_above_cents bigint check (alert_daily_spend_above_cents >= 0),
  last_synced_at        timestamptz,
  created_at            timestamptz not null default now(),
  unique (organization_id, provider, external_id)
);

create table public.ad_campaigns (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete cascade,
  account_id             uuid not null references public.ad_accounts (id) on delete cascade,
  external_id            text not null,
  name                   text not null,
  status                 text,
  objective              text,
  daily_budget_cents     bigint,
  lifetime_budget_cents  bigint,
  updated_at             timestamptz not null default now(),
  unique (account_id, external_id)
);
create index ad_campaigns_account_idx on public.ad_campaigns (account_id);

create table public.ad_insights_daily (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  account_id       uuid not null references public.ad_accounts (id) on delete cascade,
  campaign_id      uuid references public.ad_campaigns (id) on delete cascade,
  day              date not null,
  impressions      bigint not null default 0,
  reach            bigint,
  clicks           bigint not null default 0,
  spend_cents      bigint not null default 0,
  conversions      numeric(14, 2),
  unique nulls not distinct (account_id, campaign_id, day)
);
create index ad_insights_account_day_idx on public.ad_insights_daily (account_id, day);

alter table public.ad_accounts enable row level security;
alter table public.ad_campaigns enable row level security;
alter table public.ad_insights_daily enable row level security;

create policy ad_accounts_select on public.ad_accounts for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('ads.read')));
create policy ad_accounts_update on public.ad_accounts for update to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('ads.manage')))
  with check (organization_id = (select private.org_id()));
-- Escrita de dados vindos das APIs: somente o servidor.
revoke insert, delete on public.ad_accounts from authenticated;
revoke update on public.ad_accounts from authenticated;
grant update (is_selected, alert_balance_below_cents, alert_daily_spend_above_cents) on public.ad_accounts to authenticated;

create policy ad_campaigns_select on public.ad_campaigns for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('ads.read')));
create policy ad_insights_select on public.ad_insights_daily for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('ads.read')));
revoke insert, update, delete on public.ad_campaigns, public.ad_insights_daily from authenticated;

create trigger audit_ad_accounts after update on public.ad_accounts
  for each row execute function private.audit_row('', 'is_selected,alert_balance_below_cents,alert_daily_spend_above_cents');

-- -----------------------------------------------------------------------------
-- Central de notificações
-- -----------------------------------------------------------------------------
create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  kind             text not null check (char_length(kind) <= 60),
  title            text not null check (char_length(title) <= 200),
  body             text check (char_length(body) <= 1000),
  href             text check (href ~ '^/[^/]'),
  dedupe_key       text not null check (char_length(dedupe_key) <= 200),
  read_at          timestamptz,
  created_at       timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke insert, delete on public.notifications from authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Gera notificações do dia para o usuário atual (idempotente pela chave).
-- Chamado ao abrir o sistema; tarefas vencidas, prazos de hoje, reuniões
-- próximas, contas vencendo e convites pendentes.
create or replace function public.refresh_my_notifications()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_org uuid := private.org_id();
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_count int;
  v_total int := 0;
begin
  if v_org is null then
    return 0;
  end if;

  insert into public.notifications (organization_id, user_id, kind, title, href, dedupe_key)
  select v_org, v_me, 'tarefa_atrasada', 'Tarefa atrasada: ' || left(t.title, 150), '/tarefas?periodo=atrasadas', 'tarefa_atrasada:' || t.id
  from public.tasks t
  where t.owner_id = v_me and t.deleted_at is null and t.status in ('a_fazer', 'em_andamento') and t.due_at < now()
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_count = row_count; v_total := v_total + v_count;

  insert into public.notifications (organization_id, user_id, kind, title, href, dedupe_key)
  select v_org, v_me, 'prazo_hoje', 'Vence hoje: ' || left(t.title, 150), '/tarefas?periodo=hoje', 'prazo_hoje:' || t.id || ':' || v_today
  from public.tasks t
  where t.owner_id = v_me and t.deleted_at is null and t.status in ('a_fazer', 'em_andamento')
    and (t.due_at at time zone 'America/Sao_Paulo')::date = v_today and t.due_at >= now()
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_count = row_count; v_total := v_total + v_count;

  insert into public.notifications (organization_id, user_id, kind, title, body, href, dedupe_key)
  select v_org, v_me, 'reuniao', 'Reunião hoje: ' || left(e.title, 150),
         to_char(e.starts_at at time zone 'America/Sao_Paulo', 'HH24:MI'), '/agenda', 'reuniao:' || e.id
  from public.calendar_events e
  where e.owner_id = v_me and e.deleted_at is null and e.kind = 'reuniao'
    and (e.starts_at at time zone 'America/Sao_Paulo')::date = v_today and e.starts_at >= now()
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_count = row_count; v_total := v_total + v_count;

  insert into public.notifications (organization_id, user_id, kind, title, href, dedupe_key)
  select v_org, v_me, case t.kind when 'receita' then 'receber' else 'pagar' end,
         case t.kind when 'receita' then 'A receber ' else 'A pagar ' end
           || case when t.due_date < v_today then '(vencido): ' when t.due_date = v_today then 'hoje: ' else 'em breve: ' end || left(t.description, 140),
         '/financeiro/' || t.scope || '/lancamentos', 'fin:' || t.id || ':' || (t.due_date <= v_today)::text
  from public.financial_transactions t
  where t.deleted_at is null and t.status = 'previsto' and t.kind in ('receita', 'despesa')
    and t.due_date <= v_today + 2 and t.due_date >= v_today - 30
    and ((t.scope = 'pessoal' and t.owner_user_id = v_me) or (t.scope = 'empresa' and private.has_perm('finance.company.read')))
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_count = row_count; v_total := v_total + v_count;

  if private.has_perm('admin.users') then
    insert into public.notifications (organization_id, user_id, kind, title, href, dedupe_key)
    select v_org, v_me, 'convite', 'Convite pendente: ' || i.email, '/configuracoes/usuarios', 'convite:' || i.id
    from public.invitations i
    where i.organization_id = v_org and i.status = 'pendente' and i.expires_at > now() and i.created_at < now() - interval '2 days'
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics v_count = row_count; v_total := v_total + v_count;
  end if;

  -- Mantém a central enxuta: lidas há mais de 30 dias saem.
  delete from public.notifications where user_id = v_me and read_at < now() - interval '30 days';
  return v_total;
end;
$$;
revoke execute on function public.refresh_my_notifications() from public, anon;
grant execute on function public.refresh_my_notifications() to authenticated;

-- Notificação criada pelo servidor (integrações, alertas de anúncios, Google).
create or replace function public.notify_users(p_org uuid, p_perm text, p_kind text, p_title text, p_body text, p_href text, p_key text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  insert into public.notifications (organization_id, user_id, kind, title, body, href, dedupe_key)
  select p_org, p.id, p_kind, left(p_title, 200), left(p_body, 1000), p_href, p_key
  from public.profiles p
  where p.organization_id = p_org and p.is_active
    and exists (
      select 1 from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
      where ur.user_id = p.id and rp.permission_key = p_perm
    )
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.notify_users(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.notify_users(uuid, text, text, text, text, text, text) to service_role;
