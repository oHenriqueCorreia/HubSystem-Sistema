-- =============================================================================
-- Fase 3 · Tarefas, checklists, comentários, cadências e agenda
-- Decisão: tudo que precisa ser feito é uma TAREFA. Passos de cadência geram
-- tarefas, que aparecem no CRM, na agenda (quando têm horário) e em Tarefas.
-- "Atrasada" é calculado (due_at < agora e não concluída), nunca gravado.
-- =============================================================================

create type public.task_priority as enum ('baixa', 'media', 'alta', 'urgente');
create type public.task_status as enum ('a_fazer', 'em_andamento', 'concluida', 'cancelada');
create type public.contact_channel as enum ('whatsapp', 'ligacao', 'email', 'reuniao', 'outro');
create type public.event_kind as enum ('reuniao', 'compromisso', 'bloqueio');

-- -----------------------------------------------------------------------------
-- Cadências
-- -----------------------------------------------------------------------------
create table public.cadence_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 80),
  description      text not null default '' check (char_length(description) <= 500),
  is_active        boolean not null default true,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger cadence_templates_updated_at before update on public.cadence_templates
  for each row execute function private.set_updated_at();

create table public.cadence_steps (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references public.cadence_templates (id) on delete cascade,
  position     int not null default 0,
  day_offset   int not null default 0 check (day_offset between 0 and 365),
  time_of_day  time not null default '09:00',
  channel      public.contact_channel not null default 'whatsapp',
  title        text not null check (char_length(title) between 2 and 120),
  instruction  text not null default '' check (char_length(instruction) <= 2000),
  message      text not null default '' check (char_length(message) <= 2000)
);
create index cadence_steps_template_idx on public.cadence_steps (template_id, position);

create table public.cadence_enrollments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  lead_id          uuid not null references public.leads (id) on delete cascade,
  deal_id          uuid references public.deals (id) on delete set null,
  template_id      uuid not null references public.cadence_templates (id) on delete restrict,
  owner_id         uuid references public.profiles (id) on delete set null,
  status           text not null default 'ativa' check (status in ('ativa', 'pausada', 'concluida', 'cancelada')),
  started_at       timestamptz not null default now(),
  created_by       uuid default auth.uid() references auth.users (id) on delete set null
);
create index cadence_enrollments_lead_idx on public.cadence_enrollments (lead_id);

-- -----------------------------------------------------------------------------
-- Tarefas
-- -----------------------------------------------------------------------------
create table public.tasks (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  title                  text not null check (char_length(title) between 1 and 200),
  description            text check (char_length(description) <= 10000),
  owner_id               uuid default auth.uid() references public.profiles (id) on delete set null,
  priority               public.task_priority not null default 'media',
  status                 public.task_status not null default 'a_fazer',
  start_date             date,
  due_at                 timestamptz,
  has_time               boolean not null default false,
  duration_minutes       int check (duration_minutes between 5 and 1440),
  category               text check (char_length(category) <= 60),
  position               double precision not null default 0,
  lead_id                uuid references public.leads (id) on delete set null,
  deal_id                uuid references public.deals (id) on delete set null,
  cadence_enrollment_id  uuid references public.cadence_enrollments (id) on delete set null,
  cadence_step_id        uuid references public.cadence_steps (id) on delete set null,
  channel                public.contact_channel,
  suggested_message      text check (char_length(suggested_message) <= 2000),
  outcome                text check (char_length(outcome) <= 2000),
  completed_at           timestamptz,
  completed_by           uuid references auth.users (id) on delete set null,
  created_by             uuid default auth.uid() references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  check (start_date is null or due_at is null or start_date <= (due_at at time zone 'America/Sao_Paulo')::date)
);
create index tasks_owner_due_idx on public.tasks (organization_id, owner_id, status, due_at) where deleted_at is null;
create index tasks_due_idx on public.tasks (organization_id, due_at) where deleted_at is null and status in ('a_fazer', 'em_andamento');
create index tasks_lead_idx on public.tasks (lead_id) where deleted_at is null;
create index tasks_enrollment_idx on public.tasks (cadence_enrollment_id);
create trigger tasks_updated_at before update on public.tasks
  for each row execute function private.set_updated_at();

create table public.task_checklist_items (
  id        uuid primary key default gen_random_uuid(),
  task_id   uuid not null references public.tasks (id) on delete cascade,
  title     text not null check (char_length(title) between 1 and 200),
  position  double precision not null default 0,
  done_at   timestamptz,
  done_by   uuid references auth.users (id) on delete set null
);
create index task_checklist_items_task_idx on public.task_checklist_items (task_id, position);

create table public.task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id) on delete cascade,
  author_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 5000),
  created_at  timestamptz not null default now()
);
create index task_comments_task_idx on public.task_comments (task_id, created_at);

create table public.task_tags (
  task_id  uuid not null references public.tasks (id) on delete cascade,
  tag_id   uuid not null references public.tags (id) on delete cascade,
  primary key (task_id, tag_id)
);

-- -----------------------------------------------------------------------------
-- Agenda
-- -----------------------------------------------------------------------------
create table public.calendar_events (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  title             text not null check (char_length(title) between 1 and 200),
  description       text check (char_length(description) <= 10000),
  kind              public.event_kind not null default 'reuniao',
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  all_day           boolean not null default false,
  location          text check (char_length(location) <= 300),
  meet_url          text check (char_length(meet_url) <= 500),
  owner_id          uuid default auth.uid() references public.profiles (id) on delete set null,
  lead_id           uuid references public.leads (id) on delete set null,
  deal_id           uuid references public.deals (id) on delete set null,
  reminder_minutes  int[] not null default '{30}',
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  check (ends_at >= starts_at),
  check (ends_at - starts_at <= interval '31 days')
);
create index calendar_events_owner_idx on public.calendar_events (organization_id, owner_id, starts_at) where deleted_at is null;
create index calendar_events_range_idx on public.calendar_events using gist (tstzrange(starts_at, ends_at)) where deleted_at is null;
create index calendar_events_lead_idx on public.calendar_events (lead_id) where deleted_at is null;
create trigger calendar_events_updated_at before update on public.calendar_events
  for each row execute function private.set_updated_at();

create table public.event_attendees (
  event_id  uuid not null references public.calendar_events (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  primary key (event_id, user_id)
);
create index event_attendees_user_idx on public.event_attendees (user_id);

-- -----------------------------------------------------------------------------
-- Regras
-- -----------------------------------------------------------------------------
create or replace function private.can_read_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task and t.organization_id = private.org_id() and t.deleted_at is null
      and (private.can('tasks.read', t.owner_id) or t.created_by = auth.uid())
  );
$$;

create or replace function private.can_read_event(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.calendar_events e
    where e.id = p_event and e.organization_id = private.org_id() and e.deleted_at is null
      and (private.can('calendar.read', e.owner_id)
           or exists (select 1 from public.event_attendees a where a.event_id = e.id and a.user_id = auth.uid()))
  );
$$;

grant execute on function private.can_read_task(uuid), private.can_read_event(uuid) to authenticated;

-- Atribuir a outra pessoa exige escopo além de "próprios"; vínculo com lead exige enxergar o lead.
create or replace function private.tasks_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or current_setting('hub.trusted_op', true) = 'on' then
    return new;
  end if;
  if new.owner_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id)
     and coalesce(private.perm_scope('tasks.create'), 'own') = 'own' then
    raise exception 'Você só pode atribuir tarefas a si mesmo.' using errcode = '42501';
  end if;
  if new.lead_id is not null and (tg_op = 'INSERT' or new.lead_id is distinct from old.lead_id)
     and not private.can_read_lead(new.lead_id) then
    raise exception 'Lead não encontrado.' using errcode = '42501';
  end if;
  if new.status = 'concluida' and (tg_op = 'INSERT' or old.status <> 'concluida') then
    new.completed_at := coalesce(new.completed_at, now());
    new.completed_by := auth.uid();
  elsif new.status <> 'concluida' then
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end;
$$;

create trigger tasks_guard before insert or update on public.tasks
  for each row execute function private.tasks_guard();

-- Concluir tarefa de contato registra a interação na linha do tempo do lead.
create or replace function private.tasks_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lead_id is not null and new.status = 'concluida' and (tg_op = 'INSERT' or old.status <> 'concluida') then
    insert into public.activities (organization_id, lead_id, deal_id, type, content, metadata, created_by)
    values (new.organization_id, new.lead_id, new.deal_id,
            case new.channel when 'whatsapp' then 'whatsapp' when 'ligacao' then 'ligacao' when 'email' then 'email'
                             when 'reuniao' then 'reuniao' else 'tarefa' end::public.activity_type,
            'Tarefa concluída: ' || new.title || coalesce(E'\n' || nullif(new.outcome, ''), ''),
            jsonb_build_object('task_id', new.id), auth.uid());
  end if;
  return null;
end;
$$;

create trigger tasks_after after insert or update on public.tasks
  for each row execute function private.tasks_after();

create trigger audit_tasks after update or delete on public.tasks
  for each row execute function private.audit_row('', 'owner_id,deleted_at');

create or replace function private.events_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or current_setting('hub.trusted_op', true) = 'on' then
    return new;
  end if;
  if new.owner_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id)
     and coalesce(private.perm_scope('calendar.manage'), 'own') = 'own' then
    raise exception 'Você só pode criar eventos na própria agenda.' using errcode = '42501';
  end if;
  if new.lead_id is not null and (tg_op = 'INSERT' or new.lead_id is distinct from old.lead_id)
     and not private.can_read_lead(new.lead_id) then
    raise exception 'Lead não encontrado.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger events_guard before insert or update on public.calendar_events
  for each row execute function private.events_guard();

create trigger audit_calendar_events after update or delete on public.calendar_events
  for each row execute function private.audit_row('', 'owner_id,starts_at,deleted_at');

-- Inscreve um lead numa cadência e gera uma tarefa por passo.
create or replace function public.enroll_cadence(p_lead uuid, p_template uuid, p_start date default null, p_owner uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := private.org_id();
  v_enroll uuid;
  v_start date := coalesce(p_start, (now() at time zone 'America/Sao_Paulo')::date);
  v_owner uuid := coalesce(p_owner, auth.uid());
  v_deal uuid;
  v_lead_name text;
  v_step record;
begin
  if not private.has_perm('tasks.create') then
    raise exception 'Você não tem permissão para criar tarefas.' using errcode = '42501';
  end if;
  select name into v_lead_name from public.leads where id = p_lead;
  if v_lead_name is null then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.cadence_templates where id = p_template and is_active) then
    raise exception 'Cadência não encontrada ou inativa.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.cadence_enrollments where lead_id = p_lead and template_id = p_template and status = 'ativa') then
    raise exception 'Este lead já está nesta cadência.' using errcode = 'P0001';
  end if;

  select id into v_deal from public.deals where lead_id = p_lead and deleted_at is null order by created_at limit 1;

  insert into public.cadence_enrollments (organization_id, lead_id, deal_id, template_id, owner_id)
  values (v_org, p_lead, v_deal, p_template, v_owner)
  returning id into v_enroll;

  for v_step in select * from public.cadence_steps where template_id = p_template order by position loop
    insert into public.tasks (organization_id, title, description, owner_id, priority, due_at, has_time,
                              lead_id, deal_id, cadence_enrollment_id, cadence_step_id, channel, suggested_message, category)
    values (v_org, v_step.title || ' · ' || v_lead_name, nullif(v_step.instruction, ''), v_owner, 'media',
            ((v_start + v_step.day_offset) + v_step.time_of_day) at time zone 'America/Sao_Paulo', true,
            p_lead, v_deal, v_enroll, v_step.id, v_step.channel, nullif(v_step.message, ''), 'Cadência');
  end loop;

  insert into public.activities (organization_id, lead_id, deal_id, type, content, metadata)
  select v_org, p_lead, v_deal, 'sistema', 'Cadência iniciada: ' || name, jsonb_build_object('enrollment_id', v_enroll)
  from public.cadence_templates where id = p_template;

  update public.leads
     set next_contact_at = least(coalesce(next_contact_at, 'infinity'),
                                 (select min(due_at) from public.tasks where cadence_enrollment_id = v_enroll))
   where id = p_lead;

  return v_enroll;
end;
$$;

grant execute on function public.enroll_cadence(uuid, uuid, date, uuid) to authenticated;

-- Cancela as tarefas pendentes de uma inscrição.
create or replace function public.cancel_enrollment(p_enrollment uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.cadence_enrollments set status = 'cancelada' where id = p_enrollment;
  if not found then
    raise exception 'Inscrição não encontrada.' using errcode = 'P0002';
  end if;
  update public.tasks set status = 'cancelada'
   where cadence_enrollment_id = p_enrollment and status in ('a_fazer', 'em_andamento');
end;
$$;

grant execute on function public.cancel_enrollment(uuid) to authenticated;

-- Concluir a última tarefa da cadência encerra a inscrição.
create or replace function private.enrollment_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cadence_enrollment_id is not null and new.status in ('concluida', 'cancelada')
     and not exists (select 1 from public.tasks
                     where cadence_enrollment_id = new.cadence_enrollment_id and status in ('a_fazer', 'em_andamento')
                       and deleted_at is null) then
    update public.cadence_enrollments set status = 'concluida'
     where id = new.cadence_enrollment_id and status = 'ativa';
  end if;
  return null;
end;
$$;

create trigger tasks_enrollment_progress after update of status on public.tasks
  for each row execute function private.enrollment_progress();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.cadence_templates enable row level security;
alter table public.cadence_steps enable row level security;
alter table public.cadence_enrollments enable row level security;
alter table public.tasks enable row level security;
alter table public.task_checklist_items enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_tags enable row level security;
alter table public.calendar_events enable row level security;
alter table public.event_attendees enable row level security;

create policy cadence_templates_select on public.cadence_templates for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('crm.cadences.read')));
create policy cadence_templates_write on public.cadence_templates for all to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('crm.cadences.manage')))
  with check (organization_id = (select private.org_id()) and (select private.has_perm('crm.cadences.manage')));

create policy cadence_steps_select on public.cadence_steps for select to authenticated
  using (exists (select 1 from public.cadence_templates t where t.id = template_id and t.organization_id = (select private.org_id()))
         and (select private.has_perm('crm.cadences.read')));
create policy cadence_steps_write on public.cadence_steps for all to authenticated
  using ((select private.has_perm('crm.cadences.manage'))
         and exists (select 1 from public.cadence_templates t where t.id = template_id and t.organization_id = (select private.org_id())))
  with check ((select private.has_perm('crm.cadences.manage'))
         and exists (select 1 from public.cadence_templates t where t.id = template_id and t.organization_id = (select private.org_id())));

create policy cadence_enrollments_select on public.cadence_enrollments for select to authenticated
  using (organization_id = (select private.org_id()) and private.can_read_lead(lead_id));
create policy cadence_enrollments_insert on public.cadence_enrollments for insert to authenticated
  with check (organization_id = (select private.org_id()) and private.can_read_lead(lead_id) and (select private.has_perm('tasks.create')));
create policy cadence_enrollments_update on public.cadence_enrollments for update to authenticated
  using (organization_id = (select private.org_id()) and private.can_read_lead(lead_id)
         and (owner_id = (select auth.uid()) or private.can('tasks.update', owner_id)));

create policy tasks_select on public.tasks for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is null
         and (private.can('tasks.read', owner_id) or created_by = (select auth.uid())));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (organization_id = (select private.org_id()) and (select private.has_perm('tasks.create')));
create policy tasks_update on public.tasks for update to authenticated
  using (organization_id = (select private.org_id())
         and (private.can('tasks.update', owner_id) or created_by = (select auth.uid()) or private.can('tasks.delete', owner_id)))
  with check (organization_id = (select private.org_id()));

create policy task_items_select on public.task_checklist_items for select to authenticated
  using (private.can_read_task(task_id));
create policy task_items_write on public.task_checklist_items for all to authenticated
  using (private.can_read_task(task_id)) with check (private.can_read_task(task_id));

create policy task_comments_select on public.task_comments for select to authenticated
  using (private.can_read_task(task_id));
create policy task_comments_insert on public.task_comments for insert to authenticated
  with check (private.can_read_task(task_id) and author_id = (select auth.uid()));
create policy task_comments_delete on public.task_comments for delete to authenticated
  using (author_id = (select auth.uid()));

create policy task_tags_all on public.task_tags for all to authenticated
  using (private.can_read_task(task_id)) with check (private.can_read_task(task_id));

create policy events_select on public.calendar_events for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is null
         and (private.can('calendar.read', owner_id)
              or exists (select 1 from public.event_attendees a where a.event_id = calendar_events.id and a.user_id = (select auth.uid()))));
create policy events_insert on public.calendar_events for insert to authenticated
  with check (organization_id = (select private.org_id()) and (select private.has_perm('calendar.manage')));
create policy events_update on public.calendar_events for update to authenticated
  using (organization_id = (select private.org_id()) and private.can('calendar.manage', owner_id))
  with check (organization_id = (select private.org_id()));

create policy event_attendees_select on public.event_attendees for select to authenticated
  using (private.can_read_event(event_id) or user_id = (select auth.uid()));
create policy event_attendees_write on public.event_attendees for all to authenticated
  using (exists (select 1 from public.calendar_events e where e.id = event_id and private.can('calendar.manage', e.owner_id)))
  with check (exists (select 1 from public.calendar_events e where e.id = event_id and private.can('calendar.manage', e.owner_id)));

-- -----------------------------------------------------------------------------
-- Cadência inicial (exemplo editável)
-- -----------------------------------------------------------------------------
create or replace function private.seed_cadences(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t uuid;
begin
  if exists (select 1 from public.cadence_templates where organization_id = p_org) then
    return;
  end if;
  insert into public.cadence_templates (organization_id, name, description)
  values (p_org, 'Prospecção de site (7 dias)', 'Primeiro contato pelo WhatsApp, ligação de reforço e retomada.')
  returning id into v_t;
  insert into public.cadence_steps (template_id, position, day_offset, time_of_day, channel, title, instruction, message) values
    (v_t, 0, 0, '09:30', 'whatsapp', 'Primeiro contato', 'Apresente-se e ofereça mostrar a demonstração do site.',
     'Olá, {nome}! Tudo bem? Vi a {empresa} no Google e preparei uma ideia de site para vocês. Posso te mostrar?'),
    (v_t, 1, 2, '10:00', 'ligacao', 'Ligação de reforço', 'Ligue se não houve resposta. Confirme quem decide.', ''),
    (v_t, 2, 4, '14:00', 'whatsapp', 'Enviar demonstração', 'Mande o link da demonstração e peça um retorno.',
     'Oi, {nome}! Segue a demonstração do site da {empresa}. O que achou?'),
    (v_t, 3, 7, '10:00', 'whatsapp', 'Retomada', 'Última tentativa da cadência. Se não responder, avalie mover para Perdido.',
     'Olá, {nome}! Passando para saber se faz sentido conversarmos sobre o site da {empresa}.');
end;
$$;

select private.seed_cadences(id) from public.organizations;
