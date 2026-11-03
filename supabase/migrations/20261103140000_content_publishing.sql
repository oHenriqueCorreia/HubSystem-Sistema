-- =============================================================================
-- Trabalho · produção de conteúdo, aprovação do cliente e publicação na Meta
-- =============================================================================
--   * O conteúdo pertence a uma tarefa: quadro, lista, responsável e prazo são os dela.
--   * A situação só muda pelas funções daqui: não dá para "pular" a aprovação.
--   * Alterar legenda ou mídia aumenta a versão e derruba a aprovação: agendamentos
--     pendentes são cancelados e é preciso aprovar de novo.
--   * Tokens das páginas e o link do cliente nunca ficam legíveis pelo navegador.
-- =============================================================================

insert into public.permissions (key, module, label, position) values
  ('content.read', 'Conteúdo', 'Ver produção de conteúdo', 60),
  ('content.manage', 'Conteúdo', 'Criar conteúdo e enviar para aprovação', 61),
  ('content.publish', 'Conteúdo', 'Conectar contas e agendar publicações', 62)
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key, scope)
select r.id, x.key, 'all'
from public.roles r
join (values
  ('admin', 'content.read'), ('admin', 'content.manage'), ('admin', 'content.publish'),
  ('gestor', 'content.read'), ('gestor', 'content.manage'), ('gestor', 'content.publish'),
  ('leitura', 'content.read')
) as x(role_key, key) on x.role_key = r.key
on conflict do nothing;

create or replace function private.seed_module_permissions(p_org uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.role_permissions (role_id, permission_key, scope)
  select r.id, p.key, x.scope::public.permission_scope
  from public.roles r
  join (values
    ('gestor', 'tags.manage', 'all'), ('gestor', 'ads.read', 'all'),
    ('gestor', 'inbox.read', 'all'), ('gestor', 'inbox.reply', 'all'), ('gestor', 'inbox.manage', 'all'),
    ('gestor', 'content.read', 'all'), ('gestor', 'content.manage', 'all'), ('gestor', 'content.publish', 'all'),
    ('vendedor', 'inbox.read', 'own'), ('vendedor', 'inbox.reply', 'own'),
    ('atendente', 'inbox.read', 'own'), ('atendente', 'inbox.reply', 'own'),
    ('leitura', 'inbox.read', 'all'), ('leitura', 'ads.read', 'all'), ('leitura', 'content.read', 'all')
  ) as x(role_key, key, scope) on x.role_key = r.key
  join public.permissions p on p.key = x.key
  where r.organization_id = p_org
  on conflict (role_id, permission_key) do nothing;
$$;

alter table public.integration_connections drop constraint integration_connections_provider_check;
alter table public.integration_connections add constraint integration_connections_provider_check check (provider in ('meta_ads', 'google_ads', 'meta_social'));

create table public.social_accounts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  platform         text not null check (platform in ('facebook', 'instagram')),
  external_id      text not null,
  page_id          text not null,
  name             text not null default '',
  username         text,
  token_enc        text not null,
  status           text not null default 'ativa' check (status in ('ativa', 'expirada', 'desconectada')),
  selected         boolean not null default false,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, platform, external_id)
);
alter table public.social_accounts enable row level security;
revoke all on public.social_accounts from authenticated, anon;

create or replace function public.my_social_accounts()
returns table (id uuid, platform text, external_id text, name text, username text, status text, selected boolean, last_error text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.platform, a.external_id, a.name, a.username, a.status, a.selected, a.last_error
    from public.social_accounts a
   where a.organization_id = private.org_id() and (private.has_perm('content.read') or private.has_perm('ads.read'))
   order by a.platform, a.name;
$$;
revoke execute on function public.my_social_accounts() from public, anon;
grant execute on function public.my_social_accounts() to authenticated;

create or replace function public.my_social_connection()
returns table (status text, external_user text, expires_at timestamptz, last_error text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.status, c.external_user, c.expires_at, c.last_error from public.integration_connections c
   where c.organization_id = private.org_id() and c.provider = 'meta_social' and (private.has_perm('content.read') or private.has_perm('ads.read'));
$$;
revoke execute on function public.my_social_connection() from public, anon;
grant execute on function public.my_social_connection() to authenticated;

create table public.content_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  task_id          uuid not null unique references public.tasks (id) on delete cascade,
  client_id        uuid references public.clients (id) on delete set null,
  ad_campaign_id   uuid references public.ad_campaigns (id) on delete set null,
  caption          text not null default '' check (char_length(caption) <= 2200),
  status           text not null default 'em_producao' check (status in ('em_producao', 'aguardando_aprovacao', 'ajustes_solicitados', 'aprovado', 'agendado', 'publicado', 'erro')),
  version          int not null default 1,
  approved_version int,
  last_error       text check (char_length(last_error) <= 500),
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index content_items_org_idx on public.content_items (organization_id, status, updated_at desc);
create index content_items_client_idx on public.content_items (client_id);
create trigger content_items_updated_at before update on public.content_items
  for each row execute function private.set_updated_at();

create table public.content_assets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  content_id       uuid not null references public.content_items (id) on delete cascade,
  kind             text not null check (kind in ('imagem', 'video_drive')),
  storage_path     text,
  file_name        text check (char_length(file_name) <= 200),
  mime_type        text,
  size_bytes       bigint,
  drive_url        text check (char_length(drive_url) <= 500),
  drive_file_id    text,
  drive_status     text check (drive_status in ('ok', 'inacessivel', 'nao_verificado')),
  position         double precision not null default 0,
  created_at       timestamptz not null default now(),
  check ((kind = 'imagem' and storage_path is not null) or (kind = 'video_drive' and drive_file_id is not null))
);
create index content_assets_content_idx on public.content_assets (content_id, position);

create table public.content_review_links (
  id          uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  content_id  uuid not null references public.content_items (id) on delete cascade,
  version     int not null,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index content_review_links_content_idx on public.content_review_links (content_id);

create table public.content_reviews (
  id            uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  content_id    uuid not null references public.content_items (id) on delete cascade,
  version       int not null,
  decision      text not null check (decision in ('aprovado', 'ajustes')),
  comment       text check (char_length(comment) <= 4000),
  reviewer_name text not null check (char_length(reviewer_name) between 1 and 120),
  created_at    timestamptz not null default now()
);
create index content_reviews_content_idx on public.content_reviews (content_id, created_at desc);

create table public.content_schedules (
  id            uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  content_id    uuid not null references public.content_items (id) on delete cascade,
  account_id    uuid not null references public.social_accounts (id) on delete cascade,
  version       int not null,
  scheduled_at  timestamptz not null,
  status        text not null default 'agendado' check (status in ('agendado', 'publicando', 'publicado', 'erro', 'cancelado')),
  container_id  text,
  attempts      int not null default 0,
  external_id   text,
  permalink     text,
  error         text check (char_length(error) <= 500),
  published_at  timestamptz,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index content_schedules_open_uq on public.content_schedules (content_id, account_id) where status in ('agendado', 'publicando');
create index content_schedules_due_idx on public.content_schedules (scheduled_at) where status in ('agendado', 'publicando');
create index content_schedules_org_idx on public.content_schedules (organization_id, scheduled_at);
create trigger content_schedules_updated_at before update on public.content_schedules
  for each row execute function private.set_updated_at();

alter table public.content_items enable row level security;
alter table public.content_assets enable row level security;
alter table public.content_review_links enable row level security;
alter table public.content_reviews enable row level security;
alter table public.content_schedules enable row level security;
revoke all on public.content_review_links from authenticated, anon;

create policy content_items_select on public.content_items for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('content.read')));
create policy content_items_insert on public.content_items for insert to authenticated
  with check (organization_id = (select private.org_id()) and (select private.has_perm('content.manage')));
create policy content_items_update on public.content_items for update to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('content.manage')))
  with check (organization_id = (select private.org_id()));
create policy content_assets_select on public.content_assets for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('content.read')));
create policy content_assets_write on public.content_assets for all to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('content.manage')))
  with check (organization_id = (select private.org_id()) and (select private.has_perm('content.manage'))
              and exists (select 1 from public.content_items c where c.id = content_id and c.organization_id = (select private.org_id())));
create policy content_reviews_select on public.content_reviews for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('content.read')));
-- Agendamentos só pelas funções abaixo (conferem a aprovação).
create policy content_schedules_select on public.content_schedules for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('content.read')));

-- Armazenamento privado: o servidor gera os links depois de conferir o acesso.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('content-media', 'content-media', false, 8388608, array['image/jpeg'])
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Regras de situação e versão
-- -----------------------------------------------------------------------------
create or replace function private.content_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id or new.task_id is distinct from old.task_id then
    raise exception 'O conteúdo não pode mudar de tarefa.' using errcode = 'P0001';
  end if;
  if current_setting('hub.trusted_op', true) = 'on' then
    return new;
  end if;
  if new.status is distinct from old.status or new.approved_version is distinct from old.approved_version then
    raise exception 'A situação do conteúdo muda só pelo fluxo de aprovação e publicação.' using errcode = '42501';
  end if;
  if new.caption is distinct from old.caption or new.version <> old.version then
    if old.status = 'publicado' then
      raise exception 'Este conteúdo já foi publicado e não pode ser alterado.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.content_schedules s where s.content_id = old.id and s.status = 'publicando') then
      raise exception 'A publicação está em andamento. Aguarde o resultado para alterar.' using errcode = 'P0001';
    end if;
    new.version := greatest(new.version, old.version + 1);
    new.approved_version := null;
    new.status := 'em_producao';
    -- Quem aprovou viu a versão anterior: o link antigo para de valer e os agendamentos caem.
    update public.content_review_links set revoked_at = now() where content_id = old.id and revoked_at is null;
    update public.content_schedules set status = 'cancelado', error = 'Conteúdo alterado: precisa de nova aprovação.'
     where content_id = old.id and status = 'agendado';
  end if;
  return new;
end;
$$;
create trigger content_items_guard before update on public.content_items
  for each row execute function private.content_items_guard();

create or replace function private.content_assets_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.content_items set version = version + 1 where id = coalesce(new.content_id, old.content_id);
  return null;
end;
$$;
create trigger content_assets_touch after insert or delete or update of storage_path, drive_file_id, position on public.content_assets
  for each row execute function private.content_assets_touch();

-- Tarefa de produção criada com o conteúdo, numa transação só.
create or replace function public.create_content_task(p_title text, p_description text, p_column uuid, p_owner uuid, p_client uuid, p_campaign uuid, p_due timestamptz, p_has_time boolean)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task uuid;
  v_id uuid;
begin
  insert into public.tasks (title, description, column_id, owner_id, client_id, due_at, has_time, position, category)
  values (p_title, nullif(p_description, ''), p_column, coalesce(p_owner, auth.uid()), p_client, p_due, coalesce(p_has_time, false), extract(epoch from now()), 'Conteúdo')
  returning id into v_task;
  insert into public.content_items (task_id, client_id, ad_campaign_id) values (v_task, p_client, p_campaign) returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.create_content_task(text, text, uuid, uuid, uuid, uuid, timestamptz, boolean) from public, anon;
grant execute on function public.create_content_task(text, text, uuid, uuid, uuid, uuid, timestamptz, boolean) to authenticated;

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
revoke execute on function public.content_submit_for_approval(uuid, text, timestamptz) from public, anon;
grant execute on function public.content_submit_for_approval(uuid, text, timestamptz) to authenticated;

-- Decisão do cliente (link público, chamada só pelo servidor).
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
    perform public.notify_users(v.organization_id, 'content.manage', 'conteudo_decisao', v_title, nullif(btrim(p_comment), ''), '/conteudo/' || v.id, 'conteudo:' || l.id);
  end if;
  return 'ok';
end;
$$;
revoke execute on function public.content_decide(text, text, text, text) from public, anon, authenticated;
grant execute on function public.content_decide(text, text, text, text) to service_role;

-- Agendar: bloqueado enquanto a versão atual não estiver aprovada.
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
revoke execute on function public.content_schedule(uuid, uuid[], timestamptz) from public, anon;
grant execute on function public.content_schedule(uuid, uuid[], timestamptz) to authenticated;

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
  if p_at <= now() then
    raise exception 'Escolha uma data e um horário no futuro.' using errcode = 'P0001';
  end if;
  update public.content_schedules set scheduled_at = p_at where id = p_schedule and organization_id = private.org_id() and status = 'agendado';
  if not found then
    raise exception 'Este agendamento não pode mais ser alterado.' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.content_reschedule(uuid, timestamptz) from public, anon;
grant execute on function public.content_reschedule(uuid, timestamptz) to authenticated;

-- Situação do conteúdo a partir dos agendamentos.
create or replace function private.content_recompute(p_content uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.content_items;
  v_open int;
  v_error text;
  v_done int;
begin
  select * into v from public.content_items where id = p_content;
  select count(*) filter (where status in ('agendado', 'publicando')),
         count(*) filter (where status = 'publicado' and version = v.version),
         (array_agg(error order by updated_at desc) filter (where status = 'erro' and version = v.version))[1]
    into v_open, v_done, v_error
    from public.content_schedules where content_id = p_content;
  perform set_config('hub.trusted_op', 'on', true);
  update public.content_items
     set status = case
           when v_open > 0 then 'agendado'
           when v_error is not null then 'erro'
           when v_done > 0 then 'publicado'
           when status in ('agendado', 'erro', 'publicado') and approved_version = version then 'aprovado'
           else status end,
         last_error = v_error
   where id = p_content;
  if v_open = 0 and v_error is null and v_done > 0 then
    update public.tasks set status = 'concluida' where id = v.task_id and status in ('a_fazer', 'em_andamento');
  end if;
  perform set_config('hub.trusted_op', 'off', true);
end;
$$;
revoke execute on function private.content_recompute(uuid) from public, anon, authenticated;

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
  update public.content_schedules set status = 'cancelado'
   where id = p_schedule and organization_id = private.org_id() and status = 'agendado'
  returning content_id into v_content;
  if v_content is null then
    raise exception 'Este agendamento não pode mais ser cancelado.' using errcode = 'P0001';
  end if;
  perform private.content_recompute(v_content);
end;
$$;
revoke execute on function public.content_cancel_schedule(uuid) from public, anon;
grant execute on function public.content_cancel_schedule(uuid) to authenticated;

-- Publicador (servidor). Conteúdo alterado depois de agendar nunca é publicado: a versão precisa bater.
create or replace function public.content_claim_due(p_limit int default 10)
returns setof public.content_schedules
language sql
security definer
set search_path = ''
as $$
  update public.content_schedules s
     set status = 'publicando', attempts = s.attempts + 1
   where s.id in (
     select x.id from public.content_schedules x
       join public.content_items c on c.id = x.content_id
      where x.scheduled_at <= now() and x.attempts < 8 and c.approved_version = x.version
        and (x.status = 'agendado' or (x.status = 'publicando' and x.container_id is not null and x.updated_at < now() - interval '50 seconds'))
      order by x.scheduled_at limit p_limit for update of x skip locked)
  returning s.*;
$$;
revoke execute on function public.content_claim_due(int) from public, anon, authenticated;
grant execute on function public.content_claim_due(int) to service_role;

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
    perform public.notify_users(s.organization_id, 'content.publish', 'conteudo_erro', 'Falha ao publicar: ' || v_task.title, left(p_error, 500), '/conteudo/' || s.content_id, 'conteudo_erro:' || s.id);
  end if;
end;
$$;
revoke execute on function public.content_finish(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.content_finish(uuid, text, text, text, text, text) to service_role;

-- O relógio também acorda o publicador.
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
      or exists (select 1 from public.inbox_settings where billing_enabled)
      or exists (select 1 from public.content_schedules where status in ('agendado', 'publicando') and scheduled_at <= now());
$$;
revoke execute on function private.inbox_jobs_pending() from public, anon, authenticated;
