-- Resolve placeholders only when a lead joins a cadence; templates remain reusable.
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
  v_company_name text;
  v_step record;
begin
  if not private.has_perm('tasks.create') then
    raise exception 'Você não tem permissão para criar tarefas.' using errcode = '42501';
  end if;
  select name, coalesce(nullif(company_name, ''), name) into v_lead_name, v_company_name from public.leads where id = p_lead;
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
            p_lead, v_deal, v_enroll, v_step.id, v_step.channel, nullif(replace(replace(v_step.message, '{nome}', v_lead_name), '{empresa}', v_company_name), ''), 'Cadência');
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
