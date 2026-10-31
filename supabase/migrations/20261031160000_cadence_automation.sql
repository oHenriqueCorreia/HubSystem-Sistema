-- =============================================================================
-- Fase 9 · Cadências automáticas (com consentimento, janela de horário e
-- idempotência) e ações automáticas por etapa
-- =============================================================================
-- * Uma etapa pode enviar sozinha um MODELO APROVADO do WhatsApp, adicionar
--   etiqueta ou mover o negócio de etapa. As demais seguem como tarefa manual.
-- * O processamento grava uma execução por tarefa (cadence_runs.task_id é
--   único): nenhuma falha ou repetição envia a mesma etapa duas vezes.
-- * Antes de enviar: consentimento, pedido de interrupção, janela de horário
--   (fuso de São Paulo) e limite diário por organização.
-- =============================================================================

alter table public.cadence_templates
  add column send_window jsonb not null default '{"start": "08:00", "end": "20:00", "days": [1, 2, 3, 4, 5]}'::jsonb,
  add column require_consent boolean not null default true,
  add column daily_limit int not null default 200 check (daily_limit between 1 and 5000);

alter table public.cadence_steps
  add column auto_send boolean not null default false,
  add column whatsapp_template text check (char_length(whatsapp_template) <= 200),
  add column template_language text not null default 'pt_BR' check (char_length(template_language) <= 20),
  add column add_tag_id uuid references public.tags (id) on delete set null,
  add column move_to_stage_id uuid references public.stages (id) on delete set null,
  add check (not auto_send or channel <> 'whatsapp' or whatsapp_template is not null);

-- Evita entrada duplicada do mesmo lead na mesma cadência enquanto ela estiver em curso.
create unique index cadence_enrollments_open_uq on public.cadence_enrollments (lead_id, template_id) where status in ('ativa', 'pausada');

create table public.cadence_runs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  enrollment_id    uuid references public.cadence_enrollments (id) on delete cascade,
  task_id          uuid not null unique references public.tasks (id) on delete cascade,
  status           text not null check (status in ('processando', 'enviado', 'executado', 'bloqueado', 'erro')),
  detail           text check (char_length(detail) <= 500),
  attempts         int not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index cadence_runs_org_idx on public.cadence_runs (organization_id, created_at desc);

alter table public.cadence_runs enable row level security;
create policy cadence_runs_select on public.cadence_runs for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('crm.cadences.read')));
revoke insert, update, delete on public.cadence_runs from authenticated;

-- Pausar, retomar ou remover um lead de uma cadência (tarefas futuras saem).
create or replace function public.set_enrollment_status(p_enrollment uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.cadence_enrollments;
begin
  select * into v_e from public.cadence_enrollments where id = p_enrollment and organization_id = private.org_id();
  if v_e.id is null or not private.can_read_lead(v_e.lead_id)
     or not (v_e.owner_id = auth.uid() or private.can('tasks.update', v_e.owner_id)) then
    raise exception 'Inscrição não encontrada.' using errcode = 'P0002';
  end if;
  if p_status not in ('ativa', 'pausada', 'cancelada') then
    raise exception 'Situação inválida.' using errcode = 'P0001';
  end if;
  update public.cadence_enrollments set status = p_status where id = v_e.id;
  if p_status = 'cancelada' then
    perform set_config('hub.trusted_op', 'on', true);
    update public.tasks set status = 'cancelada'
     where cadence_enrollment_id = v_e.id and status in ('a_fazer', 'em_andamento') and deleted_at is null;
    perform set_config('hub.trusted_op', 'off', true);
  end if;
  insert into public.activities (organization_id, lead_id, type, content, metadata, created_by)
  values (v_e.organization_id, v_e.lead_id, 'sistema',
          case p_status when 'ativa' then 'Cadência retomada' when 'pausada' then 'Cadência pausada' else 'Lead removido da cadência' end,
          jsonb_build_object('enrollment_id', v_e.id, 'origem', 'manual'), auth.uid());
end;
$$;
revoke execute on function public.set_enrollment_status(uuid, text) from public, anon;
grant execute on function public.set_enrollment_status(uuid, text) to authenticated;

-- Tarefas automáticas vencidas e prontas (o servidor processa com a chave secreta).
create or replace function public.due_cadence_actions(p_limit int default 200)
returns table (
  task_id uuid, organization_id uuid, enrollment_id uuid, lead_id uuid, deal_id uuid, owner_id uuid,
  channel public.contact_channel, whatsapp_template text, template_language text, add_tag_id uuid, move_to_stage_id uuid,
  send_window jsonb, require_consent boolean, daily_limit int,
  lead_name text, lead_company text, lead_phone text, consent_at timestamptz, opt_out_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.organization_id, e.id, t.lead_id, t.deal_id, t.owner_id,
         s.channel, s.whatsapp_template, s.template_language, s.add_tag_id, s.move_to_stage_id,
         c.send_window, c.require_consent, c.daily_limit,
         l.name, coalesce(l.company_name, l.name), coalesce(l.whatsapp_e164, l.phone_e164), l.whatsapp_consent_at, l.contact_opt_out_at
  from public.tasks t
  join public.cadence_steps s on s.id = t.cadence_step_id
  join public.cadence_enrollments e on e.id = t.cadence_enrollment_id and e.status = 'ativa'
  join public.cadence_templates c on c.id = e.template_id and c.is_active
  join public.leads l on l.id = t.lead_id and l.deleted_at is null
  where s.auto_send and t.deleted_at is null and t.status = 'a_fazer' and t.due_at <= now()
    and not exists (select 1 from public.cadence_runs r where r.task_id = t.id and r.status <> 'erro')
  order by t.due_at
  limit p_limit;
$$;
revoke execute on function public.due_cadence_actions(int) from public, anon, authenticated;
grant execute on function public.due_cadence_actions(int) to service_role;
