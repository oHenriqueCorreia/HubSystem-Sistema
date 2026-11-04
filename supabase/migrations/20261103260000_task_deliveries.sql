-- =============================================================================
-- Trabalho · entregas da tarefa e aprovação do cliente por link
-- =============================================================================
--   * Uma tarefa tem uma ou mais entregas (post, vídeo, documento...), com quem fez e em
--     qual função. O tipo e a função são texto livre: cada empresa usa os seus nomes.
--   * O link é da tarefa e continua valendo depois da decisão: o cliente acompanha ali.
--   * A situação só muda pelas funções daqui. Nova versão zera a decisão, e uma tela aberta
--     antes disso não consegue aprovar a versão nova sem ter visto.
--   * O cliente não tem conta: tudo dele passa pelo servidor, que confere o link.
-- =============================================================================

create table public.task_deliveries (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  task_id          uuid not null references public.tasks (id) on delete cascade,
  kind             text not null default 'Post' check (char_length(btrim(kind)) between 1 and 40),
  title            text not null check (char_length(btrim(title)) between 1 and 160),
  notes            text check (char_length(notes) <= 4000),
  maker_id         uuid references public.profiles (id) on delete set null,
  maker_role       text check (char_length(maker_role) <= 60),
  status           text not null default 'aguardando' check (status in ('aguardando', 'aprovado', 'recusado')),
  version          int  not null default 1,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index task_deliveries_task_idx on public.task_deliveries (task_id, created_at);
create index task_deliveries_status_idx on public.task_deliveries (organization_id, status);
create trigger task_deliveries_updated_at before update on public.task_deliveries
  for each row execute function private.set_updated_at();

create table public.task_delivery_files (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  delivery_id      uuid not null references public.task_deliveries (id) on delete cascade,
  version          int  not null,
  kind             text not null check (kind in ('imagem', 'video', 'documento', 'drive')),
  storage_path     text unique,
  drive_file_id    text,
  file_name        text not null check (char_length(file_name) <= 200),
  mime             text,
  size_bytes       bigint,
  created_at       timestamptz not null default now(),
  check ((storage_path is not null) <> (drive_file_id is not null))
);
create index task_delivery_files_delivery_idx on public.task_delivery_files (delivery_id, version, created_at);

create table public.task_delivery_reviews (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  delivery_id      uuid not null references public.task_deliveries (id) on delete cascade,
  version          int  not null,
  decision         text not null check (decision in ('aprovado', 'recusado', 'comentario')),
  comment          text check (char_length(comment) <= 4000),
  reviewer_name    text not null check (char_length(reviewer_name) between 1 and 120),
  created_at       timestamptz not null default now()
);
create index task_delivery_reviews_delivery_idx on public.task_delivery_reviews (delivery_id, created_at);

create table public.task_delivery_review_files (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  review_id        uuid not null references public.task_delivery_reviews (id) on delete cascade,
  kind             text not null check (kind in ('audio', 'imagem')),
  storage_path     text not null unique,
  created_at       timestamptz not null default now()
);
create index task_delivery_review_files_review_idx on public.task_delivery_review_files (review_id);

-- O token fica cifrado para a equipe poder copiar o mesmo link de novo; a busca é pelo hash.
create table public.task_delivery_links (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  task_id          uuid not null references public.tasks (id) on delete cascade,
  token_hash       text not null unique,
  token_enc        text not null,
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);
create unique index task_delivery_links_active_idx on public.task_delivery_links (task_id) where revoked_at is null;

-- -----------------------------------------------------------------------------
-- Acesso
-- -----------------------------------------------------------------------------
create function public.can_manage_task_deliveries(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
     where t.id = p_task and t.deleted_at is null and t.organization_id = private.org_id()
       and (private.can('tasks.update', t.owner_id) or t.created_by = auth.uid())
  );
$$;
revoke execute on function public.can_manage_task_deliveries(uuid) from public, anon;
grant execute on function public.can_manage_task_deliveries(uuid) to authenticated;

alter table public.task_deliveries enable row level security;
alter table public.task_delivery_files enable row level security;
alter table public.task_delivery_reviews enable row level security;
alter table public.task_delivery_review_files enable row level security;
alter table public.task_delivery_links enable row level security;

revoke all on public.task_delivery_links from authenticated, anon;
revoke all on public.task_delivery_reviews, public.task_delivery_review_files, public.task_delivery_files from anon;
revoke insert, update, delete on public.task_delivery_reviews, public.task_delivery_review_files, public.task_delivery_files from authenticated;
revoke all on public.task_deliveries from anon;
-- Situação e versão ficam de fora: mudam só pelas funções abaixo.
revoke update on public.task_deliveries from authenticated;
grant update (kind, title, notes, maker_id, maker_role) on public.task_deliveries to authenticated;

create policy task_deliveries_select on public.task_deliveries for select to authenticated
  using (organization_id = (select private.org_id()) and private.can_read_task(task_id));
create policy task_deliveries_insert on public.task_deliveries for insert to authenticated
  with check (organization_id = (select private.org_id()) and public.can_manage_task_deliveries(task_id));
create policy task_deliveries_update on public.task_deliveries for update to authenticated
  using (public.can_manage_task_deliveries(task_id)) with check (public.can_manage_task_deliveries(task_id));
create policy task_deliveries_delete on public.task_deliveries for delete to authenticated
  using (public.can_manage_task_deliveries(task_id));

create policy task_delivery_files_select on public.task_delivery_files for select to authenticated
  using (exists (select 1 from public.task_deliveries d where d.id = delivery_id));
create policy task_delivery_reviews_select on public.task_delivery_reviews for select to authenticated
  using (exists (select 1 from public.task_deliveries d where d.id = delivery_id));
create policy task_delivery_review_files_select on public.task_delivery_review_files for select to authenticated
  using (exists (select 1 from public.task_delivery_reviews r where r.id = review_id));

-- Armazenamento privado: o servidor gera os links depois de conferir o acesso.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('task-deliveries', 'task-deliveries', false, 52428800, array[
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]),
  ('task-delivery-feedback', 'task-delivery-feedback', false, 15728640, array[
    'image/jpeg', 'image/png', 'image/webp',
    'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac'
  ])
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Nova versão: a decisão anterior deixa de valer
-- -----------------------------------------------------------------------------
create function public.task_delivery_new_version(p_delivery uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.task_deliveries;
begin
  select * into d from public.task_deliveries where id = p_delivery for update;
  if d.id is null or not public.can_manage_task_deliveries(d.task_id) then
    raise exception 'Você não pode alterar esta entrega.' using errcode = '42501';
  end if;
  update public.task_deliveries set version = d.version + 1, status = 'aguardando' where id = d.id;
  return d.version + 1;
end;
$$;
revoke execute on function public.task_delivery_new_version(uuid) from public, anon;
grant execute on function public.task_delivery_new_version(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Decisão do cliente (chamada só pelo servidor, que já conferiu os arquivos)
-- -----------------------------------------------------------------------------
create function public.task_delivery_decide(p_token_hash text, p_delivery uuid, p_version int, p_decision text, p_comment text, p_name text, p_files jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.task_delivery_links;
  d public.task_deliveries;
  t public.tasks;
  v_review uuid;
  v_title text;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_files jsonb := coalesce(p_files, '[]'::jsonb);
  v_user uuid;
begin
  select * into l from public.task_delivery_links where token_hash = p_token_hash;
  if l.id is null or l.revoked_at is not null or l.expires_at < now() then
    return 'link_invalido';
  end if;
  select * into t from public.tasks where id = l.task_id and deleted_at is null;
  select * into d from public.task_deliveries where id = p_delivery and task_id = l.task_id for update;
  if t.id is null or d.id is null then
    return 'link_invalido';
  end if;
  if d.version <> p_version then
    return 'versao_antiga';
  end if;
  if d.status = 'aprovado' then
    return 'ja_aprovado';
  end if;
  if p_decision in ('recusado', 'comentario') and v_comment is null and jsonb_array_length(v_files) = 0 then
    return 'comentario_obrigatorio';
  end if;
  if p_decision = 'comentario' and d.status <> 'recusado' then
    return 'decida_primeiro';
  end if;

  insert into public.task_delivery_reviews (organization_id, delivery_id, version, decision, comment, reviewer_name)
  values (d.organization_id, d.id, d.version, p_decision, v_comment, left(btrim(p_name), 120))
  returning id into v_review;

  insert into public.task_delivery_review_files (organization_id, review_id, kind, storage_path)
  select d.organization_id, v_review, f ->> 'kind', f ->> 'path'
    from jsonb_array_elements(v_files) f;

  if p_decision <> 'comentario' then
    update public.task_deliveries set status = p_decision where id = d.id;
  end if;
  -- Recusa devolve a tarefa à equipe, como no Estúdio.
  if p_decision = 'recusado' and t.status in ('concluida', 'a_fazer') then
    update public.tasks set status = 'em_andamento' where id = t.id;
  end if;

  v_title := case p_decision
    when 'aprovado' then 'Aprovado pelo cliente: '
    when 'recusado' then 'Recusado pelo cliente: '
    else 'Novo comentário do cliente: ' end || d.title;
  for v_user in
    select distinct u from unnest(array[d.maker_id, t.owner_id, t.created_by]) u where u is not null
  loop
    perform private.notify(d.organization_id, v_user, 'entrega_decisao', v_title, coalesce(v_comment, case when jsonb_array_length(v_files) > 0 then 'O cliente enviou áudio ou imagens.' end), '/tarefas?tarefa=' || t.id, 'entrega:' || v_review);
  end loop;
  return 'ok';
end;
$$;
revoke execute on function public.task_delivery_decide(text, uuid, int, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.task_delivery_decide(text, uuid, int, text, text, text, jsonb) to service_role;
