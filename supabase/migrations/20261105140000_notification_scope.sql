-- =============================================================================
-- Notificações respeitam o escopo do registro
-- =============================================================================
-- Antes: um aviso sobre um conteúdo ou uma conta de anúncio ia para todos com a
-- permissão do módulo, mesmo quem não enxerga aquele registro (o título leva o
-- nome do cliente/conta).
-- Agora notify_users aceita o contexto do registro:
--   p_client  cliente do registro; p_owner  dono/autor; p_record  aviso de registro.
-- Com contexto, recebe quem tem escopo "todos", é o dono (ou da equipe dele, com
-- escopo "equipe") ou trabalha no cliente. Sem contexto, nada muda (avisos da
-- empresa, como conexão expirada).
-- =============================================================================

create or replace function private.user_is_client_member(p_user uuid, p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_client is not null and (
    exists (select 1 from public.client_members m where m.client_id = p_client and m.user_id = p_user)
    or exists (
      select 1 from public.team_clients tc
      join public.team_members tm on tm.team_id = tc.team_id
      where tc.client_id = p_client and tm.user_id = p_user
    )
  );
$$;

create or replace function private.users_share_team(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_a = p_b or exists (
    select 1 from public.team_members a join public.team_members b on b.team_id = a.team_id
    where a.user_id = p_a and b.user_id = p_b
  );
$$;

revoke execute on function private.user_is_client_member(uuid, uuid), private.users_share_team(uuid, uuid) from public, anon;
grant execute on function private.user_is_client_member(uuid, uuid), private.users_share_team(uuid, uuid) to authenticated, service_role;

-- Novos parâmetros têm valor padrão: chamadas antigas (7 argumentos) continuam iguais.
drop function public.notify_users(uuid, text, text, text, text, text, text);
create function public.notify_users(
  p_org uuid, p_perm text, p_kind text, p_title text, p_body text, p_href text, p_key text,
  p_client uuid default null, p_owner uuid default null, p_record boolean default false
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
  v_record boolean := p_record or p_client is not null or p_owner is not null;
begin
  insert into public.notifications (organization_id, user_id, kind, title, body, href, dedupe_key)
  select p_org, x.id, p_kind, left(p_title, 200), left(p_body, 1000), p_href, p_key
  from (
    select p.id, private.user_perm_scope(p.id, p_perm) as scope
    from public.profiles p
    where p.organization_id = p_org and p.is_active
  ) x
  where x.scope is not null
    and (not v_record
         or x.scope = 'all'
         or (p_owner is not null and (x.id = p_owner or (x.scope = 'team' and private.users_share_team(x.id, p_owner))))
         or private.user_is_client_member(x.id, p_client))
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.notify_users(uuid, text, text, text, text, text, text, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.notify_users(uuid, text, text, text, text, text, text, uuid, uuid, boolean) to service_role;

-- -----------------------------------------------------------------------------
-- Avisos de conteúdo com o contexto do item
-- -----------------------------------------------------------------------------
create or replace function public.content_decide(p_token_hash text, p_decision text, p_comment text, p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.content_review_links;
  v public.content_items;
  t public.tasks;
  v_title text;
begin
  select * into l from public.content_review_links where token_hash = p_token_hash for update;
  if l.id is null or l.revoked_at is not null or l.expires_at < now() then
    return 'link_invalido';
  end if;
  select * into v from public.content_items where id = l.content_id for update;
  if v.version <> l.version or v.status <> 'aguardando_aprovacao' then
    return 'ja_decidido';
  end if;
  if p_decision = 'ajustes' and btrim(coalesce(p_comment, '')) = '' then
    return 'comentario_obrigatorio';
  end if;
  insert into public.content_reviews (organization_id, content_id, version, decision, comment, reviewer_name)
  values (v.organization_id, v.id, v.version, p_decision, nullif(btrim(p_comment), ''), left(btrim(p_name), 120));
  perform set_config('hub.trusted_op', 'on', true);
  update public.content_items
     set status = case when p_decision = 'aprovado' then 'aprovado' else 'ajustes_solicitados' end,
         approved_version = case when p_decision = 'aprovado' then v.version end
   where id = v.id;
  update public.content_review_links set revoked_at = now() where id = l.id;
  select * into t from public.tasks where id = v.task_id;
  -- Ajustes devolvem a tarefa à equipe.
  if p_decision = 'ajustes' and t.status in ('concluida', 'a_fazer') then
    update public.tasks set status = 'em_andamento' where id = t.id;
  end if;
  perform set_config('hub.trusted_op', 'off', true);
  v_title := case when p_decision = 'aprovado' then 'Conteúdo aprovado: ' else 'Ajustes pedidos: ' end || t.title;
  if t.owner_id is not null then
    perform private.notify(v.organization_id, t.owner_id, 'conteudo_decisao', v_title, nullif(btrim(p_comment), ''), '/conteudo/' || v.id, 'conteudo:' || l.id);
  else
    -- Só quem pode ver este conteúdo (escopo, autor e clientes associados).
    perform public.notify_users(v.organization_id, 'content.manage', 'conteudo_decisao', v_title, nullif(btrim(p_comment), ''), '/conteudo/' || v.id, 'conteudo:' || l.id,
      p_client => v.client_id, p_owner => v.created_by, p_record => true);
  end if;
  return 'ok';
end;
$$;

create or replace function public.content_finish(p_schedule uuid, p_status text, p_external text, p_permalink text, p_error text, p_container text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.content_schedules;
  v_task public.tasks;
begin
  update public.content_schedules
     set status = p_status, external_id = p_external, permalink = p_permalink, error = left(p_error, 500), container_id = p_container,
         published_at = case when p_status = 'publicado' then now() end
   where id = p_schedule
  returning * into s;
  if s.id is null then
    return;
  end if;
  perform private.content_recompute(s.content_id);
  if p_status = 'erro' then
    select t.* into v_task from public.tasks t join public.content_items c on c.task_id = t.id where c.id = s.content_id;
    perform public.notify_users(s.organization_id, 'content.publish', 'conteudo_erro', 'Falha ao publicar: ' || v_task.title, left(p_error, 500), '/conteudo/' || s.content_id, 'conteudo_erro:' || s.id,
      p_client => (select c.client_id from public.content_items c where c.id = s.content_id),
      p_owner => (select c.created_by from public.content_items c where c.id = s.content_id), p_record => true);
  end if;
end;
$$;
