-- =============================================================================
-- Fase 5 · Agenda: convidados externos, tarefas no Google, notificações push
-- e disponibilidade
-- =============================================================================

-- Convidados por e-mail (qualquer pessoa, dentro ou fora do Hub System). O
-- Google envia o convite quando o evento é sincronizado com sendUpdates=all.
create table public.event_guests (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.calendar_events (id) on delete cascade,
  email            text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name             text not null default '' check (char_length(name) <= 120),
  optional         boolean not null default false,
  response_status  text not null default 'needsAction'
                   check (response_status in ('needsAction', 'accepted', 'declined', 'tentative')),
  created_at       timestamptz not null default now(),
  unique (event_id, email)
);

create index event_guests_event_idx on public.event_guests (event_id);

alter table public.event_guests enable row level security;
create policy event_guests_select on public.event_guests for select to authenticated
  using (private.can_read_event(event_id));
create policy event_guests_write on public.event_guests for all to authenticated
  using (private.can_manage_event(event_id))
  with check (private.can_manage_event(event_id));

-- Enviar convite/atualizações por e-mail aos convidados (padrão: sim).
alter table public.calendar_events add column send_updates boolean not null default true;

-- Tarefas com prazo também vão para o Google Agenda do responsável.
alter table public.tasks
  add column google_event_id text,
  add column google_etag text,
  add column google_synced_at timestamptz;
create unique index tasks_google_uq on public.tasks (owner_id, google_event_id) where google_event_id is not null;

-- Conexão: escopos concedidos, agendas usadas para "ocupado" e canal de push.
alter table public.google_calendar_connections
  add column scopes text[] not null default '{}',
  add column busy_calendar_ids text[] not null default '{primary}',
  add column channel_id text,
  add column channel_resource_id text,
  add column channel_token text,
  add column channel_expires_at timestamptz;
create unique index google_connections_channel_uq on public.google_calendar_connections (channel_id) where channel_id is not null;

drop function public.my_google_connection();
create or replace function public.my_google_connection()
returns table (google_email text, status text, last_synced_at timestamptz, last_error text,
               scopes text[], busy_calendar_ids text[], push_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.google_email, c.status, c.last_synced_at, c.last_error, c.scopes, c.busy_calendar_ids,
         coalesce(c.channel_expires_at > now(), false)
  from public.google_calendar_connections c
  where c.user_id = auth.uid();
$$;

revoke execute on function public.my_google_connection() from public, anon;
grant execute on function public.my_google_connection() to authenticated;
