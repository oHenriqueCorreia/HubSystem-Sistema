-- =============================================================================
-- Fase 7 · LGPD: anonimização de titular (lead/cliente)
-- Mantém os registros financeiros e contratuais (obrigação legal) e remove os
-- dados pessoais identificáveis. Irreversível e auditado.
-- =============================================================================

create or replace function public.lgpd_anonymize_lead(p_lead uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.org_id();
begin
  if not private.has_perm('admin.data_export') then
    raise exception 'Você não tem permissão para tratar dados pessoais (LGPD).' using errcode = '42501';
  end if;
  if not exists (select 1 from public.leads where id = p_lead and organization_id = v_org) then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;
  if char_length(coalesce(trim(p_reason), '')) < 5 then
    raise exception 'Informe o motivo da anonimização.' using errcode = 'P0001';
  end if;

  perform set_config('hub.trusted_op', 'on', true);

  update public.leads set
    name = 'Titular anonimizado', company_name = null, phone_raw = null, phone_e164 = null, phone_type = null,
    whatsapp_e164 = null, email = null, website = null, instagram = null, facebook = null, linkedin = null,
    address = null, neighborhood = null, zip = null, lat = null, lng = null, place_id = null, gmb_url = null,
    notes = null, status = 'descartado', next_contact_at = null
  where id = p_lead;

  update public.clients set legal_name = null, document = null, billing_email = null, billing_phone_e164 = null, notes = null
  where lead_id = p_lead;

  update public.activities set content = null, metadata = '{}'::jsonb where lead_id = p_lead;
  delete from public.lead_tags where lead_id = p_lead;
  update public.tasks set description = null, suggested_message = null, outcome = null where lead_id = p_lead;
  update public.attachments set deleted_at = now() where entity_type = 'lead' and entity_id = p_lead and deleted_at is null;

  perform set_config('hub.trusted_op', 'off', true);

  perform private.log_event('lgpd_anonymize', 'leads', p_lead::text, jsonb_build_object('motivo', left(p_reason, 300)));
end;
$$;

grant execute on function public.lgpd_anonymize_lead(uuid, text) to authenticated;

-- Registra na auditoria cada exportação de dados de titular.
create or replace function public.lgpd_log_export(p_lead uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_perm('admin.data_export') then
    raise exception 'Você não tem permissão para exportar dados pessoais.' using errcode = '42501';
  end if;
  perform private.log_event('lgpd_export', 'leads', p_lead::text, '{}'::jsonb);
end;
$$;

grant execute on function public.lgpd_log_export(uuid) to authenticated;
