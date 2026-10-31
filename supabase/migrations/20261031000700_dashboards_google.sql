-- =============================================================================
-- Fase 6 · Indicadores comerciais e integração com o Google Calendar
-- =============================================================================

-- Indicadores comerciais do período. SECURITY INVOKER: a RLS limita os números
-- ao que o usuário pode ver (vendedor vê os próprios; gestor vê todos).
create or replace function public.commercial_dashboard(p_from date, p_to date, p_owner uuid default null, p_pipeline uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with
  bounds as (
    select (p_from::timestamp at time zone 'America/Sao_Paulo') as t0,
           ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo') as t1
  ),
  pipe as (
    select coalesce(p_pipeline, (select id from public.pipelines where is_active order by position limit 1)) as id
  ),
  d as (
    select d.* from public.deals d, pipe
    where d.deleted_at is null and d.pipeline_id = pipe.id and (p_owner is null or d.owner_id = p_owner)
  ),
  hist as (
    select h.*, s.name as stage_name, s.kind from public.deal_stage_history h
    join d on d.id = h.deal_id
    join public.stages s on s.id = h.to_stage_id, bounds
    where h.moved_at >= bounds.t0 and h.moved_at < bounds.t1
  ),
  won as (select * from d, bounds where d.won_at >= bounds.t0 and d.won_at < bounds.t1),
  lost as (select * from d, bounds where d.lost_at >= bounds.t0 and d.lost_at < bounds.t1),
  k as (
    select k.*, s.name as service_name from public.contracts k
    left join public.services s on s.id = k.service_id
    where k.deleted_at is null and k.status <> 'cancelado' and (p_owner is null or k.owner_id = p_owner)
  ),
  kp as (select * from k where k.start_date between p_from and p_to),
  leads_in as (
    select l.* from public.leads l, bounds
    where l.deleted_at is null and (p_owner is null or l.owner_id = p_owner)
  )
  select jsonb_build_object(
    'total_leads', (select count(*) from leads_in),
    'new_leads', (select count(*) from leads_in, bounds where leads_in.created_at >= bounds.t0 and leads_in.created_at < bounds.t1),
    'by_stage', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'count', (select count(*) from d where d.stage_id = s.id),
                                          'amount', (select coalesce(sum(d.amount_cents), 0) from d where d.stage_id = s.id)) order by s.position)
      from public.stages s, pipe where s.pipeline_id = pipe.id), '[]'::jsonb),
    'by_owner', coalesce((
      select jsonb_agg(x order by (x ->> 'count')::int desc) from (
        select jsonb_build_object('owner_id', d.owner_id, 'name', coalesce(p.full_name, 'Sem responsável'), 'count', count(*),
                                  'won', count(*) filter (where d.won_at is not null)) as x
        from d left join public.profiles p on p.id = d.owner_id
        group by d.owner_id, p.full_name
      ) t), '[]'::jsonb),
    'meetings', (select count(*) from public.calendar_events e, bounds
                 where e.deleted_at is null and e.kind = 'reuniao' and e.starts_at >= bounds.t0 and e.starts_at < bounds.t1
                   and (p_owner is null or e.owner_id = p_owner)),
    'meetings_stage', (select count(distinct deal_id) from hist where stage_name ilike 'reuni%'),
    'proposals', (select count(distinct deal_id) from hist where stage_name ilike 'proposta%'),
    'won', (select count(*) from won),
    'lost', (select count(*) from lost),
    'lost_reasons', coalesce((
      select jsonb_agg(jsonb_build_object('name', coalesce(r.name, 'Sem motivo'), 'count', c) order by c desc)
      from (select lost_reason_id, count(*) c from lost group by lost_reason_id) x
      left join public.lost_reasons r on r.id = x.lost_reason_id), '[]'::jsonb),
    'revenue', (select coalesce(sum(amount_cents), 0) from kp),
    'contracts', (select count(*) from kp),
    'mrr', (select coalesce(sum(case recurrence when 'mensal' then amount_cents when 'trimestral' then amount_cents / 3
                                                 when 'semestral' then amount_cents / 6 when 'anual' then amount_cents / 12 else 0 end), 0)
            from k where status = 'ativo'),
    'by_month', coalesce((
      select jsonb_agg(jsonb_build_object('month', m, 'amount', amount, 'count', cnt) order by m)
      from (select to_char(start_date, 'YYYY-MM') m, sum(amount_cents) amount, count(*) cnt
            from k where start_date >= (p_to - interval '11 months')::date and start_date <= p_to group by 1) x), '[]'::jsonb),
    'by_service', coalesce((
      select jsonb_agg(jsonb_build_object('name', coalesce(service_name, 'Outros'), 'amount', amount, 'count', cnt) order by amount desc)
      from (select service_name, sum(amount_cents) amount, count(*) cnt from kp group by service_name) x), '[]'::jsonb),
    'pipeline_open_amount', (select coalesce(sum(d.amount_cents), 0) from d join public.stages s on s.id = d.stage_id where s.kind = 'open'),
    'forecast', coalesce((
      select jsonb_agg(jsonb_build_object('month', m, 'amount', amount) order by m)
      from (select to_char(expected_close_date, 'YYYY-MM') m, sum(d.amount_cents) amount
            from d join public.stages s on s.id = d.stage_id
            where s.kind = 'open' and d.expected_close_date is not null and d.amount_cents is not null
              and d.expected_close_date between (now() at time zone 'America/Sao_Paulo')::date and ((now() at time zone 'America/Sao_Paulo')::date + 90)
            group by 1) x), '[]'::jsonb),
    'overdue_tasks', (select count(*) from public.tasks t where t.deleted_at is null and t.status in ('a_fazer', 'em_andamento')
                        and t.due_at < now() and (p_owner is null or t.owner_id = p_owner)),
    'overdue_contacts', (select count(*) from leads_in where next_contact_at < now())
  );
$$;

grant execute on function public.commercial_dashboard(date, date, uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Google Calendar
-- Tokens ficam cifrados (AES-GCM no servidor) e esta tabela não tem políticas:
-- só o servidor, com a chave secreta, lê ou grava. O navegador nunca vê tokens.
-- -----------------------------------------------------------------------------
create table public.google_calendar_connections (
  user_id            uuid primary key references public.profiles (id) on delete cascade,
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  google_email       text not null,
  calendar_id        text not null default 'primary',
  refresh_token_enc  text not null,
  access_token_enc   text,
  access_expires_at  timestamptz,
  sync_token         text,
  status             text not null default 'ativa' check (status in ('ativa', 'erro', 'revogada')),
  last_synced_at     timestamptz,
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.google_calendar_connections enable row level security;
revoke all on public.google_calendar_connections from authenticated, anon;

alter table public.calendar_events add column source text not null default 'interno' check (source in ('interno', 'google'));
alter table public.calendar_events add column google_event_id text;
alter table public.calendar_events add column google_etag text;
alter table public.calendar_events add column google_synced_at timestamptz;
create unique index calendar_events_google_uq on public.calendar_events (owner_id, google_event_id) where google_event_id is not null;

-- Estado da conexão sem expor tokens.
create or replace function public.my_google_connection()
returns table (google_email text, status text, last_synced_at timestamptz, last_error text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.google_email, c.status, c.last_synced_at, c.last_error
  from public.google_calendar_connections c
  where c.user_id = auth.uid();
$$;

grant execute on function public.my_google_connection() to authenticated;
