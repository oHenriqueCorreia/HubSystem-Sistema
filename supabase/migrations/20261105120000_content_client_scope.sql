-- =============================================================================
-- Conteúdo respeita o escopo da permissão e os clientes associados
-- =============================================================================
-- Antes: quem tinha content.read via todo o conteúdo da empresa, e as funções
-- de aprovação/agendamento aceitavam qualquer item pelo id.
-- Agora (igual a tarefas e clientes):
--   * escopo "todos" → todo o conteúdo (papéis padrão continuam assim);
--   * "próprios"/"equipe" → o que a pessoa (ou a equipe) criou;
--   * mais o conteúdo dos clientes associados (Equipe do cliente, squads) e
--     das tarefas que a pessoa enxerga.
-- Arquivos, revisões e agendamentos seguem o item. As funções de aprovação e
-- agendamento conferem o item antes de agir.
-- =============================================================================

create or replace function private.can_on_content(p_content uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.content_items c
    where c.id = p_content and c.organization_id = private.org_id()
      and (private.can(p_key, c.created_by)
           or (private.has_perm(p_key)
               and (private.is_client_member(c.client_id)
                    or (c.task_id is not null and private.can_read_task(c.task_id)))))
  );
$$;

revoke execute on function private.can_on_content(uuid, text) from public, anon;
grant execute on function private.can_on_content(uuid, text) to authenticated, service_role;

drop policy content_items_select on public.content_items;
create policy content_items_select on public.content_items for select to authenticated
  using (organization_id = (select private.org_id())
         and (private.can('content.read', created_by)
              or ((select private.has_perm('content.read'))
                  and (private.is_client_member(client_id) or (task_id is not null and private.can_read_task(task_id))))));

drop policy content_items_update on public.content_items;
create policy content_items_update on public.content_items for update to authenticated
  using (organization_id = (select private.org_id())
         and (private.can('content.manage', created_by)
              or ((select private.has_perm('content.manage'))
                  and (private.is_client_member(client_id) or (task_id is not null and private.can_read_task(task_id))))))
  with check (organization_id = (select private.org_id()));

drop policy content_assets_select on public.content_assets;
create policy content_assets_select on public.content_assets for select to authenticated
  using (organization_id = (select private.org_id()) and private.can_on_content(content_id, 'content.read'));
drop policy content_assets_write on public.content_assets;
create policy content_assets_write on public.content_assets for all to authenticated
  using (organization_id = (select private.org_id()) and private.can_on_content(content_id, 'content.manage'))
  with check (organization_id = (select private.org_id()) and private.can_on_content(content_id, 'content.manage'));

drop policy content_reviews_select on public.content_reviews;
create policy content_reviews_select on public.content_reviews for select to authenticated
  using (organization_id = (select private.org_id()) and private.can_on_content(content_id, 'content.read'));
drop policy content_schedules_select on public.content_schedules;
create policy content_schedules_select on public.content_schedules for select to authenticated
  using (organization_id = (select private.org_id()) and private.can_on_content(content_id, 'content.read'));

-- -----------------------------------------------------------------------------
-- Funções que agiam sobre qualquer item pelo id
-- -----------------------------------------------------------------------------

create or replace function public.content_submit_for_approval(p_content uuid, p_token_hash text, p_expires timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.content_items;
begin
  if not private.has_perm('content.manage') then
    raise exception 'Você não tem permissão para enviar para aprovação.' using errcode = '42501';
  end if;
  -- Só no conteúdo que a pessoa pode alterar (escopo e clientes associados).
  if not private.can_on_content(p_content, 'content.manage') then
    raise exception 'Conteúdo não encontrado.' using errcode = 'P0002';
  end if;
  select * into v from public.content_items where id = p_content and organization_id = private.org_id();
  if v.id is null then
    raise exception 'Conteúdo não encontrado.' using errcode = 'P0002';
  end if;
  if v.status not in ('em_producao', 'ajustes_solicitados', 'aguardando_aprovacao') then
    raise exception 'Este conteúdo já foi aprovado. Altere-o antes de pedir nova aprovação.' using errcode = 'P0001';
  end if;
  if btrim(v.caption) = '' and not exists (select 1 from public.content_assets a where a.content_id = v.id) then
    raise exception 'Adicione a legenda ou uma mídia antes de enviar.' using errcode = 'P0001';
  end if;
  update public.content_review_links set revoked_at = now() where content_id = v.id and revoked_at is null;
  insert into public.content_review_links (organization_id, content_id, version, token_hash, expires_at, created_by)
  values (v.organization_id, v.id, v.version, p_token_hash, p_expires, auth.uid());
  perform set_config('hub.trusted_op', 'on', true);
  update public.content_items set status = 'aguardando_aprovacao' where id = v.id;
  perform set_config('hub.trusted_op', 'off', true);
end;
$$;

create or replace function public.content_internal_approve(p_content uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.content_items;
  v_name text;
begin
  if not private.has_perm('content.publish') then
    raise exception 'Você não tem permissão para aprovar publicações.' using errcode = '42501';
  end if;
  -- Só no conteúdo que a pessoa pode alterar (escopo e clientes associados).
  if not private.can_on_content(p_content, 'content.publish') then
    raise exception 'Conteúdo não encontrado.' using errcode = 'P0002';
  end if;
  select * into v from public.content_items where id = p_content and organization_id = private.org_id() for update;
  if v.id is null then
    raise exception 'Conteúdo não encontrado.' using errcode = 'P0002';
  end if;
  if v.client_id is not null then
    raise exception 'Conteúdo de cliente precisa da aprovação dele pelo link.' using errcode = 'P0001';
  end if;
  if v.status not in ('em_producao', 'ajustes_solicitados', 'aguardando_aprovacao') then
    return;
  end if;
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
  insert into public.content_reviews (organization_id, content_id, version, decision, comment, reviewer_name)
  values (v.organization_id, v.id, v.version, 'aprovado', 'Aprovado pela equipe.', left(coalesce(v_name, 'Equipe'), 120));
  update public.content_review_links set revoked_at = now() where content_id = v.id and revoked_at is null;
  perform set_config('hub.trusted_op', 'on', true);
  update public.content_items set status = 'aprovado', approved_version = v.version where id = v.id;
  perform set_config('hub.trusted_op', 'off', true);
end;
$$;

create or replace function public.content_schedule(p_content uuid, p_accounts uuid[], p_at timestamptz)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.content_items;
  v_count int;
begin
  if not private.has_perm('content.publish') then
    raise exception 'Você não tem permissão para agendar publicações.' using errcode = '42501';
  end if;
  -- Só no conteúdo que a pessoa pode alterar (escopo e clientes associados).
  if not private.can_on_content(p_content, 'content.publish') then
    raise exception 'Conteúdo não encontrado.' using errcode = 'P0002';
  end if;
  select * into v from public.content_items where id = p_content and organization_id = private.org_id() for update;
  if v.id is null then
    raise exception 'Conteúdo não encontrado.' using errcode = 'P0002';
  end if;
  if v.status not in ('aprovado', 'agendado', 'erro') or v.approved_version is distinct from v.version then
    raise exception 'O agendamento fica bloqueado até o cliente aprovar a versão atual.' using errcode = 'P0001';
  end if;
  if p_at <= now() then
    raise exception 'Escolha uma data e um horário no futuro.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_accounts, 1), 0) = 0 then
    raise exception 'Escolha ao menos uma conta de destino.' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(p_accounts) x(id)
              where not exists (select 1 from public.social_accounts a where a.id = x.id and a.organization_id = v.organization_id and a.status = 'ativa')) then
    raise exception 'Alguma conta escolhida está desconectada. Reconecte antes de agendar.' using errcode = 'P0001';
  end if;
  insert into public.content_schedules (organization_id, content_id, account_id, version, scheduled_at, created_by)
  select v.organization_id, v.id, x.id, v.version, p_at, auth.uid() from unnest(p_accounts) x(id)
  on conflict (content_id, account_id) where status in ('agendado', 'publicando') do update set scheduled_at = excluded.scheduled_at, error = null;
  get diagnostics v_count = row_count;
  perform set_config('hub.trusted_op', 'on', true);
  update public.content_items set status = 'agendado', last_error = null where id = v.id;
  perform set_config('hub.trusted_op', 'off', true);
  return v_count;
end;
$$;

create or replace function public.content_reschedule(p_schedule uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_perm('content.publish') then
    raise exception 'Você não tem permissão para agendar publicações.' using errcode = '42501';
  end if;
  -- Só no conteúdo que a pessoa pode alterar (escopo e clientes associados).
  if not private.can_on_content((select s.content_id from public.content_schedules s where s.id = p_schedule and s.organization_id = private.org_id()), 'content.publish') then
    raise exception 'Conteúdo não encontrado.' using errcode = 'P0002';
  end if;
  if p_at <= now() then
    raise exception 'Escolha uma data e um horário no futuro.' using errcode = 'P0001';
  end if;
  update public.content_schedules set scheduled_at = p_at where id = p_schedule and organization_id = private.org_id() and status = 'agendado';
  if not found then
    raise exception 'Este agendamento não pode mais ser alterado.' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.content_cancel_schedule(p_schedule uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_content uuid;
begin
  if not private.has_perm('content.publish') then
    raise exception 'Você não tem permissão para cancelar publicações.' using errcode = '42501';
  end if;
  -- Só no conteúdo que a pessoa pode alterar (escopo e clientes associados).
  if not private.can_on_content((select s.content_id from public.content_schedules s where s.id = p_schedule and s.organization_id = private.org_id()), 'content.publish') then
    raise exception 'Conteúdo não encontrado.' using errcode = 'P0002';
  end if;
  update public.content_schedules set status = 'cancelado'
   where id = p_schedule and organization_id = private.org_id() and status = 'agendado'
  returning content_id into v_content;
  if v_content is null then
    raise exception 'Este agendamento não pode mais ser cancelado.' using errcode = 'P0001';
  end if;
  perform private.content_recompute(v_content);
end;
$$;
