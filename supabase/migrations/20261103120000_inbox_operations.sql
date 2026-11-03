-- =============================================================================
-- Atendimento · radar, indicadores, conversões, cobrança, automações, webhooks e campanhas
-- =============================================================================
--   * Tudo é aditivo. Os gatilhos novos nunca derrubam a operação de origem: uma
--     falha aqui vira aviso no log, e mover o negócio ou receber a mensagem continua.
--   * O trabalho pesado (chamar a Meta, enviar mensagem, chamar webhook) roda em
--     /api/inbox/jobs, acionado pelo mesmo relógio de um minuto das notificações.
--   * Cobrança automática e retorno de conversões começam desligados.
-- =============================================================================

create table public.inbox_settings (
  organization_id      uuid primary key default private.org_id() references public.organizations (id) on delete cascade,
  radar_client_minutes int not null default 120 check (radar_client_minutes between 5 and 10080),
  radar_contact_hours  int not null default 48 check (radar_contact_hours between 1 and 720),
  radar_notify         boolean not null default true,
  billing_enabled      boolean not null default false,
  billing_days_before  int not null default 1 check (billing_days_before between 0 and 30),
  billing_message      text not null default 'Olá {nome}! Lembrete: {descricao}, no valor de {valor}, vence em {vencimento}. Para não receber estes avisos, responda SAIR.' check (char_length(billing_message) between 10 and 1000),
  campaign_daily_limit int not null default 200 check (campaign_daily_limit between 1 and 2000),
  updated_at           timestamptz not null default now()
);
alter table public.inbox_settings enable row level security;
grant select, insert, update, delete on public.inbox_settings to authenticated;
grant all on public.inbox_settings to service_role;
create policy inbox_settings_select on public.inbox_settings for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('inbox.read')));
create policy inbox_settings_write on public.inbox_settings for all to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('inbox.manage')))
  with check (organization_id = (select private.org_id()) and (select private.has_perm('inbox.manage')));

-- -----------------------------------------------------------------------------
-- Eventos: fila única para automações e webhooks de saída
-- -----------------------------------------------------------------------------
create table public.automations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  name            text not null check (char_length(name) between 2 and 120),
  enabled         boolean not null default true,
  trigger         text not null check (trigger in ('mensagem_recebida', 'conversa_nova', 'conversa_encerrada', 'conversa_esfriou', 'etapa_alterada', 'lead_criado')),
  condition       jsonb not null default '{}'::jsonb,
  actions         jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array'),
  delay_minutes   int not null default 0 check (delay_minutes between 0 and 43200),
  created_at      timestamptz not null default now()
);
create index automations_org_trigger_idx on public.automations (organization_id, trigger) where enabled;
alter table public.automations enable row level security;
grant select, insert, update, delete on public.automations to authenticated;
grant all on public.automations to service_role;
create policy automations_all on public.automations for all to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('inbox.manage')))
  with check (organization_id = (select private.org_id()) and (select private.has_perm('inbox.manage')));

create table public.webhook_endpoints (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (char_length(name) between 2 and 120),
  url             text not null check (url ~ '^https://' and char_length(url) <= 500),
  secret_enc      text not null,
  events          text[] not null,
  enabled         boolean not null default true,
  created_at      timestamptz not null default now()
);
-- O segredo só o servidor lê: a tela usa a função abaixo.
alter table public.webhook_endpoints enable row level security;
revoke all on public.webhook_endpoints from authenticated, anon;
grant all on public.webhook_endpoints to service_role;

create or replace function public.my_webhook_endpoints()
returns table (id uuid, name text, url text, events text[], enabled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.name, e.url, e.events, e.enabled from public.webhook_endpoints e
   where e.organization_id = private.org_id() and private.has_perm('inbox.manage') order by e.created_at;
$$;
revoke execute on function public.my_webhook_endpoints() from public, anon;
grant execute on function public.my_webhook_endpoints() to authenticated;

create table public.inbound_hooks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (char_length(name) between 2 and 120),
  token_hash      text not null unique,
  pipeline_id     uuid references public.pipelines (id) on delete set null,
  owner_id        uuid references public.profiles (id) on delete set null,
  enabled         boolean not null default true,
  last_used_at    timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.inbound_hooks enable row level security;
grant select on public.inbound_hooks to authenticated;
grant all on public.inbound_hooks to service_role;
create policy inbound_hooks_select on public.inbound_hooks for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('inbox.manage')));

create table public.hub_events (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind            text not null,
  conversation_id uuid references public.conversations (id) on delete cascade,
  lead_id         uuid references public.leads (id) on delete cascade,
  deal_id         uuid references public.deals (id) on delete cascade,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz
);
create index hub_events_pending_idx on public.hub_events (id) where claimed_at is null;
alter table public.hub_events enable row level security;
revoke all on public.hub_events from authenticated, anon;
grant all on public.hub_events to service_role;
grant usage, select on sequence public.hub_events_id_seq to service_role;

create table public.automation_runs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  automation_id   uuid not null references public.automations (id) on delete cascade,
  event_id        bigint not null references public.hub_events (id) on delete cascade,
  status          text not null default 'pendente' check (status in ('pendente', 'processando', 'feito', 'bloqueado', 'erro')),
  detail          text check (char_length(detail) <= 500),
  run_after       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (automation_id, event_id)
);
create index automation_runs_due_idx on public.automation_runs (run_after) where status = 'pendente';
alter table public.automation_runs enable row level security;
grant select on public.automation_runs to authenticated;
grant all on public.automation_runs to service_role;
create policy automation_runs_select on public.automation_runs for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('inbox.manage')));

create table public.webhook_deliveries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  endpoint_id     uuid not null references public.webhook_endpoints (id) on delete cascade,
  event_id        bigint not null references public.hub_events (id) on delete cascade,
  status          text not null default 'pendente' check (status in ('pendente', 'processando', 'entregue', 'erro')),
  attempts        int not null default 0,
  response_status int,
  next_try_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (endpoint_id, event_id)
);
create index webhook_deliveries_due_idx on public.webhook_deliveries (next_try_at) where status = 'pendente';
alter table public.webhook_deliveries enable row level security;
grant select on public.webhook_deliveries to authenticated;
grant all on public.webhook_deliveries to service_role;
create policy webhook_deliveries_select on public.webhook_deliveries for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('inbox.manage')));

-- Só grava evento se alguém da organização vai usar: sem automação nem webhook, nada cresce.
create or replace function private.emit_hub_event(p_org uuid, p_kind text, p_conversation uuid, p_lead uuid, p_deal uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.automations a where a.organization_id = p_org and a.enabled and a.trigger = p_kind)
     or exists (select 1 from public.webhook_endpoints e where e.organization_id = p_org and e.enabled and p_kind = any (e.events)) then
    insert into public.hub_events (organization_id, kind, conversation_id, lead_id, deal_id, payload)
    values (p_org, p_kind, p_conversation, p_lead, p_deal, coalesce(p_payload, '{}'::jsonb));
  end if;
end;
$$;
revoke execute on function private.emit_hub_event(uuid, text, uuid, uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function private.hub_event_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead uuid;
begin
  if new.direction = 'entrada' then
    select lead_id into v_lead from public.conversations where id = new.conversation_id;
    perform private.emit_hub_event(new.organization_id, 'mensagem_recebida', new.conversation_id, v_lead, null,
      jsonb_build_object('message_id', new.id, 'type', new.type, 'body', left(new.body, 1000)));
  end if;
  return null;
exception when others then
  raise warning 'hub_event_message: %', sqlerrm;
  return null;
end;
$$;
create trigger hub_event_message after insert on public.messages
  for each row execute function private.hub_event_message();

create or replace function private.hub_event_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.emit_hub_event(new.organization_id, 'conversa_nova', new.id, new.lead_id, null, jsonb_build_object('contact_e164', new.contact_e164, 'contact_name', new.contact_name));
  elsif new.status = 'encerrada' and old.status is distinct from 'encerrada' then
    perform private.emit_hub_event(new.organization_id, 'conversa_encerrada', new.id, new.lead_id, null, jsonb_build_object('outcome', new.outcome));
  end if;
  return null;
exception when others then
  raise warning 'hub_event_conversation: %', sqlerrm;
  return null;
end;
$$;
create trigger hub_event_conversation after insert or update of status on public.conversations
  for each row execute function private.hub_event_conversation();

create or replace function private.hub_event_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.import_id is null then
    perform private.emit_hub_event(new.organization_id, 'lead_criado', null, new.id, null, jsonb_build_object('name', new.name, 'source', new.source));
  end if;
  return null;
exception when others then
  raise warning 'hub_event_lead: %', sqlerrm;
  return null;
end;
$$;
create trigger hub_event_lead after insert on public.leads
  for each row execute function private.hub_event_lead();

-- -----------------------------------------------------------------------------
-- Retorno de vendas para a Meta (Conversions API)
-- -----------------------------------------------------------------------------
create table public.conversion_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  enabled         boolean not null default false,
  dataset_id      text not null check (dataset_id ~ '^\d{5,30}$'),
  waba_id         text check (waba_id ~ '^\d{5,30}$'),
  token_enc       text not null,
  updated_at      timestamptz not null default now()
);
alter table public.conversion_settings enable row level security;
revoke all on public.conversion_settings from authenticated, anon;
grant all on public.conversion_settings to service_role;

create or replace function public.my_conversion_settings()
returns table (enabled boolean, dataset_id text, waba_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.enabled, c.dataset_id, c.waba_id from public.conversion_settings c
   where c.organization_id = private.org_id() and private.has_perm('inbox.manage');
$$;
revoke execute on function public.my_conversion_settings() from public, anon;
grant execute on function public.my_conversion_settings() to authenticated;

create table public.conversion_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  deal_id         uuid not null references public.deals (id) on delete cascade,
  lead_id         uuid references public.leads (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  event_name      text not null default 'Purchase',
  value_cents     bigint not null default 0,
  contact_e164    text,
  ctwa_clid       text,
  provider        text,
  status          text not null default 'pendente' check (status in ('pendente', 'processando', 'enviado', 'erro', 'ignorado')),
  attempts        int not null default 0,
  error           text check (char_length(error) <= 500),
  event_time      timestamptz not null default now(),
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (deal_id, event_name)
);
create index conversion_events_due_idx on public.conversion_events (created_at) where status = 'pendente';
create index conversion_events_org_idx on public.conversion_events (organization_id, created_at desc);
alter table public.conversion_events enable row level security;
grant select on public.conversion_events to authenticated;
grant all on public.conversion_events to service_role;
create policy conversion_events_select on public.conversion_events for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('inbox.manage')));

-- Negócio ganho: agenda o envio (uma vez por negócio) e avisa automações e webhooks.
create or replace function private.hub_event_deal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage record;
  v_conv record;
  v_clid text;
begin
  select id, name, kind::text as kind into v_stage from public.stages where id = new.stage_id;
  perform private.emit_hub_event(new.organization_id, 'etapa_alterada', null, new.lead_id, new.id,
    jsonb_build_object('stage_id', new.stage_id, 'stage_name', v_stage.name, 'stage_kind', v_stage.kind, 'amount_cents', new.amount_cents));
  if v_stage.kind = 'won' and exists (select 1 from public.conversion_settings s where s.organization_id = new.organization_id and s.enabled) then
    select c.id, c.contact_e164, n.provider into v_conv
      from public.conversations c join public.whatsapp_numbers n on n.id = c.number_id
     where c.lead_id = new.lead_id order by c.last_message_at desc nulls last limit 1;
    if v_conv.id is not null then
      select r.ctwa_clid into v_clid from public.ad_referrals r
       where r.conversation_id = v_conv.id and r.ctwa_clid is not null order by r.created_at limit 1;
      insert into public.conversion_events (organization_id, deal_id, lead_id, conversation_id, value_cents, contact_e164, ctwa_clid, provider)
      values (new.organization_id, new.id, new.lead_id, v_conv.id, coalesce(new.amount_cents, 0), v_conv.contact_e164, v_clid, v_conv.provider)
      on conflict (deal_id, event_name) do nothing;
    end if;
  end if;
  return null;
exception when others then
  raise warning 'hub_event_deal: %', sqlerrm;
  return null;
end;
$$;
create trigger hub_event_deal after update of stage_id on public.deals
  for each row when (old.stage_id is distinct from new.stage_id)
  execute function private.hub_event_deal();

-- -----------------------------------------------------------------------------
-- Cobrança por WhatsApp (começa desligada)
-- -----------------------------------------------------------------------------
create table public.billing_reminders (
  transaction_id  uuid primary key references public.financial_transactions (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  status          text not null check (status in ('processando', 'enviado', 'bloqueado', 'erro')),
  detail          text check (char_length(detail) <= 500),
  created_at      timestamptz not null default now()
);
create index billing_reminders_org_idx on public.billing_reminders (organization_id, created_at desc);
alter table public.billing_reminders enable row level security;
grant select on public.billing_reminders to authenticated;
grant all on public.billing_reminders to service_role;
create policy billing_reminders_select on public.billing_reminders for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('inbox.manage')));

-- -----------------------------------------------------------------------------
-- Campanhas: só para quem autorizou, com ritmo controlado
-- -----------------------------------------------------------------------------
create table public.campaigns (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  name            text not null check (char_length(name) between 2 and 120),
  number_id       uuid not null references public.whatsapp_numbers (id) on delete cascade,
  body            text not null check (char_length(body) between 1 and 4096),
  template_name   text,
  template_language text,
  template_param_count int not null default 0 check (template_param_count between 0 and 2),
  status          text not null default 'rascunho' check (status in ('rascunho', 'enviando', 'pausada', 'concluida', 'cancelada')),
  scheduled_at    timestamptz,
  created_by      uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index campaigns_running_idx on public.campaigns (organization_id) where status = 'enviando';
alter table public.campaigns enable row level security;
grant select, insert, update, delete on public.campaigns to authenticated;
grant all on public.campaigns to service_role;
create policy campaigns_all on public.campaigns for all to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('inbox.manage')))
  with check (organization_id = (select private.org_id()) and (select private.has_perm('inbox.manage')));

create function private.inbox_campaign_integrity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.whatsapp_numbers n where n.id = new.number_id and n.organization_id = new.organization_id) then
    raise exception 'Número de outra organização.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger inbox_campaign_integrity before insert or update of organization_id, number_id on public.campaigns
  for each row execute function private.inbox_campaign_integrity();

create table public.campaign_recipients (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  campaign_id     uuid not null references public.campaigns (id) on delete cascade,
  lead_id         uuid not null references public.leads (id) on delete cascade,
  status          text not null default 'pendente' check (status in ('pendente', 'processando', 'enviado', 'bloqueado', 'erro')),
  detail          text check (char_length(detail) <= 500),
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (campaign_id, lead_id)
);
create index campaign_recipients_due_idx on public.campaign_recipients (campaign_id, created_at) where status = 'pendente';
create index campaign_recipients_sent_idx on public.campaign_recipients (organization_id, sent_at) where status = 'enviado';
alter table public.campaign_recipients enable row level security;
grant select, insert, update, delete on public.campaign_recipients to authenticated;
grant all on public.campaign_recipients to service_role;
create policy campaign_recipients_all on public.campaign_recipients for all to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('inbox.manage')))
  with check (organization_id = (select private.org_id()) and (select private.has_perm('inbox.manage')));

create function private.inbox_recipient_integrity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.campaigns c where c.id = new.campaign_id and c.organization_id = new.organization_id)
     or not exists (select 1 from public.leads l where l.id = new.lead_id and l.organization_id = new.organization_id and l.deleted_at is null) then
    raise exception 'Campanha ou contato de outra organização.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger inbox_recipient_integrity before insert or update of organization_id, campaign_id, lead_id on public.campaign_recipients
  for each row execute function private.inbox_recipient_integrity();

-- Contagem no banco: a API limita coleções embutidas a 1.000 linhas, e uma campanha pode ter 5.000 contatos.
create function public.inbox_campaign_counts()
returns table (campaign_id uuid, total bigint, enviados bigint, bloqueados bigint, erros bigint, pendentes bigint)
language sql stable security invoker set search_path = '' as $$
  select r.campaign_id, count(*)::bigint,
         count(*) filter (where r.status = 'enviado')::bigint,
         count(*) filter (where r.status = 'bloqueado')::bigint,
         count(*) filter (where r.status = 'erro')::bigint,
         count(*) filter (where r.status in ('pendente', 'processando'))::bigint
    from public.campaign_recipients r
   where r.organization_id = private.org_id() and private.has_perm('inbox.manage')
   group by r.campaign_id;
$$;
revoke execute on function public.inbox_campaign_counts() from public, anon;
grant execute on function public.inbox_campaign_counts() to authenticated;

-- -----------------------------------------------------------------------------
-- Reserva de trabalho: cada item é pego por uma execução só
-- -----------------------------------------------------------------------------
create or replace function public.inbox_jobs_claim(p_limit int default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_events jsonb;
begin
  -- Eventos viram execuções de automação e entregas de webhook.
  with picked as (
    select id from public.hub_events where claimed_at is null order by id limit p_limit for update skip locked
  ), done as (
    update public.hub_events e set claimed_at = now() from picked where e.id = picked.id returning e.*
  ), runs as (
    insert into public.automation_runs (organization_id, automation_id, event_id, run_after)
    select d.organization_id, a.id, d.id, now() + make_interval(mins => a.delay_minutes)
      from done d join public.automations a on a.organization_id = d.organization_id and a.enabled and a.trigger = d.kind
    on conflict do nothing
    returning 1
  ), deliveries as (
    insert into public.webhook_deliveries (organization_id, endpoint_id, event_id)
    select d.organization_id, w.id, d.id
      from done d join public.webhook_endpoints w on w.organization_id = d.organization_id and w.enabled and d.kind = any (w.events)
    on conflict do nothing
    returning 1
  )
  select jsonb_build_object('events', (select count(*) from done), 'runs', (select count(*) from runs), 'deliveries', (select count(*) from deliveries)) into v_events;
  return v_events;
end;
$$;
revoke execute on function public.inbox_jobs_claim(int) from public, anon, authenticated;
grant execute on function public.inbox_jobs_claim(int) to service_role;

-- Item preso em "processando" (execução que caiu) não volta sozinho: repetir poderia enviar duas vezes.
create or replace function public.inbox_jobs_claim_runs(p_limit int default 50)
returns table (id uuid, organization_id uuid, automation_id uuid, event_id bigint)
language sql
security definer
set search_path = ''
as $$
  update public.automation_runs r set status = 'processando'
   where r.id in (select x.id from public.automation_runs x where x.status = 'pendente' and x.run_after <= now() order by x.run_after limit p_limit for update skip locked)
  returning r.id, r.organization_id, r.automation_id, r.event_id;
$$;
revoke execute on function public.inbox_jobs_claim_runs(int) from public, anon, authenticated;
grant execute on function public.inbox_jobs_claim_runs(int) to service_role;

create or replace function public.inbox_jobs_claim_deliveries(p_limit int default 50)
returns table (id uuid, endpoint_id uuid, event_id bigint, attempts int)
language sql
security definer
set search_path = ''
as $$
  update public.webhook_deliveries d set status = 'processando', attempts = d.attempts + 1
   where d.id in (select x.id from public.webhook_deliveries x where x.status = 'pendente' and x.next_try_at <= now() order by x.next_try_at limit p_limit for update skip locked)
  returning d.id, d.endpoint_id, d.event_id, d.attempts;
$$;
revoke execute on function public.inbox_jobs_claim_deliveries(int) from public, anon, authenticated;
grant execute on function public.inbox_jobs_claim_deliveries(int) to service_role;

create or replace function public.inbox_jobs_claim_conversions(p_limit int default 50)
returns setof public.conversion_events
language sql
security definer
set search_path = ''
as $$
  update public.conversion_events c set status = 'processando', attempts = c.attempts + 1
   where c.id in (select x.id from public.conversion_events x where x.status = 'pendente' order by x.created_at limit p_limit for update skip locked)
  returning c.*;
$$;
revoke execute on function public.inbox_jobs_claim_conversions(int) from public, anon, authenticated;
grant execute on function public.inbox_jobs_claim_conversions(int) to service_role;

-- Próximo destinatário de cada campanha em andamento.
create or replace function public.campaign_claim_next(p_campaign uuid)
returns table (id uuid, lead_id uuid)
language sql
security definer
set search_path = ''
as $$
  update public.campaign_recipients r set status = 'processando'
   where r.id = (select x.id from public.campaign_recipients x where x.campaign_id = p_campaign and x.status = 'pendente' order by x.created_at limit 1 for update skip locked)
  returning r.id, r.lead_id;
$$;
revoke execute on function public.campaign_claim_next(uuid) from public, anon, authenticated;
grant execute on function public.campaign_claim_next(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Indicadores (respeitam a RLS de quem consulta)
-- -----------------------------------------------------------------------------
create or replace function public.inbox_report(p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select c.* from public.conversations c
     where (c.created_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'open', (select count(*) from base where status = 'aberta'),
    'closed', (select count(*) from base where status = 'encerrada'),
    'waiting', (select count(*) from base where status = 'aberta' and waiting_reply),
    'avg_first_response_seconds', (select round(avg(extract(epoch from first_response_at - created_at))) from base where first_response_at is not null),
    'by_assignee', coalesce((
      select jsonb_agg(row_to_json(x) order by x.total desc) from (
        select b.assignee_id, coalesce(p.full_name, p.email, 'Sem responsável') as name, count(*) as total,
               count(*) filter (where b.status = 'encerrada') as closed,
               round(avg(extract(epoch from b.first_response_at - b.created_at))) as avg_first_response_seconds
          from base b left join public.profiles p on p.id = b.assignee_id
         group by b.assignee_id, p.full_name, p.email
      ) x), '[]'::jsonb),
    'by_outcome', coalesce((
      select jsonb_agg(row_to_json(y) order by y.total desc) from (
        select trim(split_part(outcome, ':', 1)) as outcome, count(*) as total from base where outcome is not null group by 1
      ) y), '[]'::jsonb)
  );
$$;
revoke execute on function public.inbox_report(date, date) from public, anon;
grant execute on function public.inbox_report(date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- Radar: conversa em que o cliente espera além do limite gera aviso e evento, uma vez
-- -----------------------------------------------------------------------------
create table private.radar_alerts (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  last_message_at timestamptz not null,
  created_at      timestamptz not null default now(),
  primary key (conversation_id, last_message_at)
);

create or replace function private.radar_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_new int;
  v_title text;
  v_href text;
begin
  for r in
    select c.id, c.organization_id, c.assignee_id, c.lead_id, c.contact_name, c.contact_e164, c.last_message_at, s.radar_notify
      from public.conversations c
      left join public.inbox_settings s on s.organization_id = c.organization_id
     where c.status = 'aberta' and c.waiting_reply and c.last_message_at is not null
       and c.last_message_at < now() - make_interval(mins => coalesce(s.radar_client_minutes, 120))
       and c.last_message_at > now() - interval '7 days'
     limit 500
  loop
    insert into private.radar_alerts (conversation_id, last_message_at) values (r.id, r.last_message_at)
    on conflict do nothing;
    get diagnostics v_new = row_count;
    if v_new > 0 then
      v_title := 'Cliente esperando resposta: ' || coalesce(nullif(r.contact_name, ''), r.contact_e164);
      v_href := '/atendimento?conversa=' || r.id;
      if coalesce(r.radar_notify, true) then
        if r.assignee_id is not null then
          perform private.notify(r.organization_id, r.assignee_id, 'radar_conversa', v_title, null, v_href, 'radar:' || r.id || ':' || extract(epoch from r.last_message_at)::bigint);
        else
          perform public.notify_users(r.organization_id, 'inbox.manage', 'radar_conversa', v_title, null, v_href, 'radar:' || r.id || ':' || extract(epoch from r.last_message_at)::bigint);
        end if;
      end if;
      perform private.emit_hub_event(r.organization_id, 'conversa_esfriou', r.id, r.lead_id, null, jsonb_build_object('last_message_at', r.last_message_at));
    end if;
  end loop;
  delete from private.radar_alerts where created_at < now() - interval '30 days';
  delete from public.hub_events where claimed_at < now() - interval '30 days';
end;
$$;
revoke execute on function private.radar_tick() from public, anon, authenticated;

create or replace function private.inbox_jobs_pending()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.hub_events where claimed_at is null)
      or exists (select 1 from public.automation_runs where status = 'pendente' and run_after <= now())
      or exists (select 1 from public.webhook_deliveries where status = 'pendente' and next_try_at <= now())
      or exists (select 1 from public.conversion_events where status = 'pendente')
      or exists (select 1 from public.campaigns where status = 'enviando' and (scheduled_at is null or scheduled_at <= now()))
      or exists (select 1 from public.inbox_settings where billing_enabled);
$$;
revoke execute on function private.inbox_jobs_pending() from public, anon, authenticated;

-- O relógio ganha o radar e os trabalhos, isolados: nada aqui pode impedir os lembretes.
create or replace function private.notifications_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.generate_reminders();
  begin
    perform private.radar_tick();
  exception when others then
    raise warning 'radar_tick: %', sqlerrm;
  end;
  if exists (select 1 from public.notifications n join public.push_subscriptions s on s.user_id = n.user_id
              where n.pushed_at is null and n.created_at > now() - interval '1 day') then
    perform net.http_post(
      url := (select value from private.app_settings where key = 'site_url') || '/api/push/dispatch',
      headers := jsonb_build_object('content-type', 'application/json', 'x-hub-tick', (select value from private.app_settings where key = 'tick_token')),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000);
  end if;
  begin
    if private.inbox_jobs_pending() then
      perform net.http_post(
        url := (select value from private.app_settings where key = 'site_url') || '/api/inbox/jobs',
        headers := jsonb_build_object('content-type', 'application/json', 'x-hub-tick', (select value from private.app_settings where key = 'tick_token')),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000);
    end if;
  exception when others then
    raise warning 'inbox_jobs: %', sqlerrm;
  end;
end;
$$;
revoke execute on function private.notifications_tick() from public, anon, authenticated;
