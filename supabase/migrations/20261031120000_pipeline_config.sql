-- =============================================================================
-- Fase 7 · Funil configurável: etapas (criar, reordenar, arquivar, excluir com
-- transferência) e funis novos
-- =============================================================================

alter table public.stages add column archived_at timestamptz;

create trigger audit_stages after insert or update or delete on public.stages
  for each row execute function private.audit_row();
create trigger audit_pipelines after insert or update or delete on public.pipelines
  for each row execute function private.audit_row();

-- Exclusão de etapa só pela RPC (os negócios precisam ir para algum lugar).
drop policy stages_write on public.stages;
create policy stages_insert on public.stages for insert to authenticated
  with check (organization_id = (select private.org_id()) and (select private.has_perm('crm.pipeline.configure'))
              and exists (select 1 from public.pipelines p where p.id = pipeline_id and p.organization_id = (select private.org_id())));
create policy stages_update on public.stages for update to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('crm.pipeline.configure')))
  with check (organization_id = (select private.org_id()));

-- Reordena as etapas de um funil na ordem dada (atômico).
create or replace function public.reorder_stages(p_pipeline uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_perm('crm.pipeline.configure') then
    raise exception 'Você não tem permissão para configurar o funil.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.pipelines where id = p_pipeline and organization_id = private.org_id()) then
    raise exception 'Funil não encontrado.' using errcode = 'P0002';
  end if;
  update public.stages s
     set position = x.ord - 1
    from unnest(p_ids) with ordinality as x(id, ord)
   where s.id = x.id and s.pipeline_id = p_pipeline;
end;
$$;

-- Exclui uma etapa: negócios vão para outra etapa do mesmo funil ou para a
-- lixeira. O funil sempre mantém ao menos uma etapa aberta ativa.
create or replace function public.delete_stage(p_stage uuid, p_target uuid default null, p_archive_deals boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_st public.stages;
  v_count int;
begin
  if not private.has_perm('crm.pipeline.configure') then
    raise exception 'Você não tem permissão para configurar o funil.' using errcode = '42501';
  end if;
  select * into v_st from public.stages where id = p_stage and organization_id = private.org_id();
  if v_st.id is null then
    raise exception 'Etapa não encontrada.' using errcode = 'P0002';
  end if;
  if v_st.kind = 'open' and not exists (
    select 1 from public.stages where pipeline_id = v_st.pipeline_id and kind = 'open' and id <> v_st.id and archived_at is null
  ) then
    raise exception 'O funil precisa de ao menos uma etapa aberta.' using errcode = 'P0001', hint = 'last_open_stage';
  end if;

  select count(*) into v_count from public.deals where stage_id = v_st.id and deleted_at is null;
  if v_count > 0 and p_target is null and not p_archive_deals then
    raise exception 'Esta etapa tem % negócio(s). Transfira ou arquive antes de excluir.', v_count
      using errcode = 'P0001', hint = 'stage_has_deals';
  end if;
  if p_target is not null and not exists (
    select 1 from public.stages where id = p_target and pipeline_id = v_st.pipeline_id and id <> v_st.id and archived_at is null
  ) then
    raise exception 'Etapa de destino inválida.' using errcode = 'P0001';
  end if;

  perform set_config('hub.trusted_op', 'on', true);
  if p_target is not null then
    update public.deals set stage_id = p_target, stage_changed_at = now() where stage_id = v_st.id and deleted_at is null;
  elsif p_archive_deals then
    update public.deals set deleted_at = now() where stage_id = v_st.id and deleted_at is null;
  end if;
  -- Negócios já na lixeira acompanham o destino (ou a primeira etapa aberta) para liberar a exclusão.
  update public.deals set stage_id = coalesce(p_target, (
    select id from public.stages where pipeline_id = v_st.pipeline_id and kind = 'open' and id <> v_st.id order by position limit 1))
   where stage_id = v_st.id;
  perform set_config('hub.trusted_op', 'off', true);

  -- Referências: modelos de mensagem e "etapa de origem" do histórico viram null;
  -- entradas do histórico para esta etapa saem junto (o nome fica na auditoria).
  delete from public.stages where id = v_st.id;
  perform private.log_event('delete_stage', 'stages', v_st.id::text,
    jsonb_build_object('nome', v_st.name, 'negocios', v_count, 'destino', p_target, 'arquivados', p_archive_deals and p_target is null));
  return v_count;
end;
$$;

-- Novo funil com etapas iniciais editáveis.
create or replace function public.create_pipeline(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.org_id();
  v_id uuid;
begin
  if not private.has_perm('crm.pipeline.configure') then
    raise exception 'Você não tem permissão para configurar o funil.' using errcode = '42501';
  end if;
  insert into public.pipelines (organization_id, name, position)
  values (v_org, trim(p_name), coalesce((select max(position) + 1 from public.pipelines where organization_id = v_org), 0))
  returning id into v_id;
  insert into public.stages (organization_id, pipeline_id, name, position, color, kind, sla_days) values
    (v_org, v_id, 'Novo', 0, 'slate', 'open', 7),
    (v_org, v_id, 'Em contato', 1, 'blue', 'open', 5),
    (v_org, v_id, 'Proposta enviada', 2, 'orange', 'open', 5),
    (v_org, v_id, 'Ganho', 3, 'green', 'won', null),
    (v_org, v_id, 'Perdido', 4, 'rose', 'lost', null);
  return v_id;
end;
$$;

revoke execute on function public.reorder_stages(uuid, uuid[]) from public, anon;
revoke execute on function public.delete_stage(uuid, uuid, boolean) from public, anon;
revoke execute on function public.create_pipeline(text) from public, anon;
grant execute on function public.reorder_stages(uuid, uuid[]) to authenticated;
grant execute on function public.delete_stage(uuid, uuid, boolean) to authenticated;
grant execute on function public.create_pipeline(text) to authenticated;
