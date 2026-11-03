-- =============================================================================
-- Estúdio de conteúdo (posts, vídeos e reels) e bate-papo do Atendimento
-- =============================================================================
--   * Conteúdo ganha formato e vídeo enviado direto para o armazenamento privado.
--   * Conteúdo sem cliente é da própria empresa: a equipe pode aprovar, com registro.
--     Com cliente, continua valendo só a aprovação pelo link.
--   * Contas guardam a foto, para aparecerem como na Meta.
--   * Mensagem pode citar outra; a lista de conversas mostra a última mensagem.
-- =============================================================================

alter table public.content_items
  add column format text not null default 'post' check (format in ('post', 'video', 'reels'));

alter table public.content_assets drop constraint content_assets_kind_check;
alter table public.content_assets add constraint content_assets_kind_check check (kind in ('imagem', 'video_drive', 'video_arquivo'));
alter table public.content_assets drop constraint content_assets_check;
alter table public.content_assets add constraint content_assets_check check (
  (kind in ('imagem', 'video_arquivo') and storage_path is not null) or (kind = 'video_drive' and drive_file_id is not null)
);

update storage.buckets
   set file_size_limit = 52428800, allowed_mime_types = array['image/jpeg', 'video/mp4', 'video/quicktime']
 where id = 'content-media';

alter table public.social_accounts
  add column picture_url text check (char_length(picture_url) <= 2000),
  add column picture_checked_at timestamptz;

drop function public.my_social_accounts();
create function public.my_social_accounts()
returns table (id uuid, platform text, external_id text, name text, username text, status text, selected boolean, last_error text, picture_url text, picture_checked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.platform, a.external_id, a.name, a.username, a.status, a.selected, a.last_error, a.picture_url, a.picture_checked_at
    from public.social_accounts a
   where a.organization_id = private.org_id() and (private.has_perm('content.read') or private.has_perm('ads.read'))
   order by a.selected desc, a.platform, a.name;
$$;
revoke execute on function public.my_social_accounts() from public, anon;
grant execute on function public.my_social_accounts() to authenticated;

-- Aprovação da equipe: só para conteúdo próprio, sem cliente, e fica no histórico com o nome de quem aprovou.
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
revoke execute on function public.content_internal_approve(uuid) from public, anon;
grant execute on function public.content_internal_approve(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Bate-papo
-- -----------------------------------------------------------------------------
alter table public.messages add column reply_to_wamid text;

create index if not exists messages_conversation_recent_idx on public.messages (conversation_id, created_at desc);

-- Última mensagem de cada conversa (a RLS define o que a pessoa vê).
create or replace function public.conversation_previews(p_ids uuid[])
returns table (conversation_id uuid, direction text, type text, body text, media_name text, status text, created_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, m.direction, m.type, left(m.body, 200), m.media_name, m.status, m.created_at
    from unnest(p_ids) as c(id)
    cross join lateral (
      select x.direction, x.type, x.body, x.media_name, x.status, x.created_at
        from public.messages x
       where x.conversation_id = c.id and x.direction <> 'nota'
       order by x.created_at desc limit 1
    ) m;
$$;
revoke execute on function public.conversation_previews(uuid[]) from public, anon;
grant execute on function public.conversation_previews(uuid[]) to authenticated;
