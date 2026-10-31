-- HubSystem · migrations posteriores à fundação em um único script (a 0100/fundação já está aplicada).
-- Como usar: Supabase → SQL Editor → New query → cole TODO este arquivo → Run.
-- Tudo roda numa transação: se algo falhar, nada é aplicado.
-- Gerado a partir de supabase/migrations/. Não edite à mão.

begin;

-- ===== supabase/migrations/20261031000200_admin_rpcs.sql
-- Fase 1 · RPCs administrativas atômicas

create extension if not exists unaccent with schema extensions;

-- Define o papel (único) de um usuário. A troca acontece numa transação,
-- então a trava "último administrador" (trigger adiado) avalia o estado final.
create or replace function public.admin_set_user_role(p_user uuid, p_role uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.org_id();
begin
  if not private.has_perm('admin.users') then
    raise exception 'Você não tem permissão para gerenciar usuários.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and organization_id = v_org) then
    raise exception 'Usuário não encontrado.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.roles where id = p_role and organization_id = v_org) then
    raise exception 'Papel não encontrado.' using errcode = 'P0002';
  end if;

  delete from public.user_roles where user_id = p_user and role_id <> p_role;
  insert into public.user_roles (user_id, role_id) values (p_user, p_role)
  on conflict (user_id, role_id) do nothing;
end;
$$;

grant execute on function public.admin_set_user_role(uuid, uuid) to authenticated;

-- Cria um papel personalizado copiando as permissões de outro (opcional).
create or replace function public.admin_create_role(p_name text, p_description text, p_copy_from uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.org_id();
  v_id uuid;
  v_key text;
begin
  if not private.has_perm('admin.roles') then
    raise exception 'Você não tem permissão para gerenciar papéis.' using errcode = '42501';
  end if;

  v_key := left(regexp_replace(lower(extensions.unaccent(p_name)), '[^a-z]+', '_', 'g'), 30)
           || '_' || translate(substr(md5(random()::text), 1, 6), '0123456789', 'ghijklmnop');
  v_key := trim(both '_' from v_key);

  insert into public.roles (organization_id, key, name, description, is_system)
  values (v_org, v_key, trim(p_name), coalesce(trim(p_description), ''), false)
  returning id into v_id;

  if p_copy_from is not null then
    insert into public.role_permissions (role_id, permission_key, scope)
    select v_id, rp.permission_key, rp.scope
    from public.role_permissions rp
    join public.roles r on r.id = rp.role_id and r.organization_id = v_org
    where rp.role_id = p_copy_from;
  end if;

  return v_id;
end;
$$;

grant execute on function public.admin_create_role(text, text, uuid) to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261031000200', 'admin_rpcs') on conflict do nothing;

-- ===== supabase/migrations/20261031000300_crm.sql
-- =============================================================================
-- Fase 2 · CRM: segmentos, etiquetas, funis, leads, negócios, histórico,
-- interações, modelos de mensagem e importação.
--   lead  = a empresa prospectada (dados de contato)
--   deal  = a oportunidade daquele lead em um funil (etapa, valor, perda)
-- =============================================================================

create type public.lead_status as enum ('ativo', 'cliente', 'descartado');
create type public.stage_kind as enum ('open', 'won', 'lost');
create type public.activity_type as enum (
  'nota', 'whatsapp', 'ligacao', 'email', 'reuniao', 'mudanca_etapa', 'importacao', 'tarefa', 'sistema'
);

-- -----------------------------------------------------------------------------
-- Cadastros de apoio
-- -----------------------------------------------------------------------------
create table public.segments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 80),
  created_at       timestamptz not null default now()
);
create unique index segments_org_name_uq on public.segments (organization_id, lower(name));

create table public.tags (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 40),
  color            text not null default 'slate'
                   check (color in ('slate', 'teal', 'blue', 'violet', 'rose', 'amber', 'green', 'orange')),
  created_at       timestamptz not null default now()
);
create unique index tags_org_name_uq on public.tags (organization_id, lower(name));

create table public.pipelines (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 60),
  position         int not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create table public.stages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  pipeline_id      uuid not null references public.pipelines (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 60),
  position         int not null default 0,
  color            text not null default 'slate',
  kind             public.stage_kind not null default 'open',
  sla_days         int check (sla_days is null or sla_days between 1 and 365),
  created_at       timestamptz not null default now()
);
create index stages_pipeline_idx on public.stages (pipeline_id, position);

create table public.lost_reasons (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 80),
  position         int not null default 0
);

create table public.message_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 80),
  body             text not null check (char_length(body) between 1 and 2000),
  channel          text not null default 'whatsapp' check (channel in ('whatsapp', 'email')),
  stage_id         uuid references public.stages (id) on delete set null,
  position         int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger message_templates_updated_at before update on public.message_templates
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Importações
-- -----------------------------------------------------------------------------
create table public.imports (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  file_name        text not null,
  total_rows       int not null default 0,
  inserted         int not null default 0,
  updated          int not null default 0,
  skipped          int not null default 0,
  invalid          int not null default 0,
  report           jsonb not null default '{}'::jsonb,
  undone_at        timestamptz,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);

create table public.import_mappings (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  signature        text not null,           -- cabeçalhos normalizados do arquivo
  mapping          jsonb not null,
  updated_at       timestamptz not null default now(),
  unique (organization_id, signature)
);

-- -----------------------------------------------------------------------------
-- Leads
-- -----------------------------------------------------------------------------
create table public.leads (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  name               text not null check (char_length(name) between 1 and 160),
  company_name       text check (char_length(company_name) <= 160),
  phone_raw          text check (char_length(phone_raw) <= 40),
  phone_e164         text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_type         text check (phone_type in ('celular', 'fixo', 'desconhecido')),
  whatsapp_e164      text check (whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email              text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  website            text check (char_length(website) <= 300),
  instagram          text check (char_length(instagram) <= 300),
  facebook           text check (char_length(facebook) <= 300),
  linkedin           text check (char_length(linkedin) <= 300),
  address            text check (char_length(address) <= 300),
  neighborhood       text check (char_length(neighborhood) <= 120),
  city               text check (char_length(city) <= 120),
  state              char(2) check (state ~ '^[A-Z]{2}$'),
  zip                text check (zip ~ '^[0-9]{5}-?[0-9]{3}$'),
  lat                double precision,
  lng                double precision,
  place_id           text,
  gmb_url            text check (char_length(gmb_url) <= 2000),
  gmb_rating         numeric(2, 1) check (gmb_rating between 0 and 5),
  gmb_reviews_count  int check (gmb_reviews_count >= 0),
  category           text check (char_length(category) <= 120),
  segment_id         uuid references public.segments (id) on delete set null,
  source             text check (char_length(source) <= 80),
  services_interest  text[] not null default '{}',
  owner_id           uuid default auth.uid() references public.profiles (id) on delete set null,
  notes              text check (char_length(notes) <= 10000),
  status             public.lead_status not null default 'ativo',
  last_contact_at    timestamptz,
  next_contact_at    timestamptz,
  import_id          uuid references public.imports (id) on delete set null,
  created_by         uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  deleted_by         uuid references auth.users (id) on delete set null
);

create unique index leads_place_uq on public.leads (organization_id, place_id) where place_id is not null and deleted_at is null;
create index leads_org_owner_idx on public.leads (organization_id, owner_id) where deleted_at is null;
create index leads_phone_idx on public.leads (organization_id, phone_e164) where deleted_at is null;
create index leads_email_idx on public.leads (organization_id, lower(email)) where deleted_at is null;
create index leads_next_contact_idx on public.leads (organization_id, next_contact_at) where deleted_at is null;
create index leads_segment_idx on public.leads (segment_id);
create index leads_import_idx on public.leads (import_id);
create index leads_name_trgm on public.leads using gin (name extensions.gin_trgm_ops);
create index leads_company_trgm on public.leads using gin (company_name extensions.gin_trgm_ops);
create index leads_city_trgm on public.leads using gin (city extensions.gin_trgm_ops);

create trigger leads_updated_at before update on public.leads
  for each row execute function private.set_updated_at();

create table public.lead_tags (
  lead_id  uuid not null references public.leads (id) on delete cascade,
  tag_id   uuid not null references public.tags (id) on delete cascade,
  primary key (lead_id, tag_id)
);
create index lead_tags_tag_idx on public.lead_tags (tag_id);

-- -----------------------------------------------------------------------------
-- Negócios (oportunidades) e histórico de etapas
-- -----------------------------------------------------------------------------
create table public.deals (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  lead_id              uuid not null references public.leads (id) on delete cascade,
  pipeline_id          uuid not null references public.pipelines (id) on delete restrict,
  stage_id             uuid not null references public.stages (id) on delete restrict,
  owner_id             uuid default auth.uid() references public.profiles (id) on delete set null,
  title                text check (char_length(title) <= 160),
  amount_cents         bigint check (amount_cents >= 0),
  billing              text check (billing in ('unico', 'mensal')),
  position             double precision not null default 0,
  expected_close_date  date,
  lost_reason_id       uuid references public.lost_reasons (id) on delete set null,
  lost_note            text check (char_length(lost_note) <= 1000),
  won_at               timestamptz,
  lost_at              timestamptz,
  stage_changed_at     timestamptz not null default now(),
  created_by           uuid default auth.uid() references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

create unique index deals_lead_pipeline_uq on public.deals (lead_id, pipeline_id) where deleted_at is null;
create index deals_board_idx on public.deals (pipeline_id, stage_id, position) where deleted_at is null;
create index deals_owner_idx on public.deals (owner_id);
create index deals_lead_idx on public.deals (lead_id);

create trigger deals_updated_at before update on public.deals
  for each row execute function private.set_updated_at();

create table public.deal_stage_history (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  deal_id         uuid not null references public.deals (id) on delete cascade,
  from_stage_id   uuid references public.stages (id) on delete set null,
  to_stage_id     uuid not null references public.stages (id) on delete cascade,
  moved_by        uuid references auth.users (id) on delete set null,
  moved_at        timestamptz not null default now()
);
create index deal_stage_history_deal_idx on public.deal_stage_history (deal_id, moved_at desc);
create index deal_stage_history_org_idx on public.deal_stage_history (organization_id, moved_at desc);

-- Linha do tempo (interações e eventos do lead)
create table public.activities (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  lead_id          uuid not null references public.leads (id) on delete cascade,
  deal_id          uuid references public.deals (id) on delete set null,
  type             public.activity_type not null,
  content          text check (char_length(content) <= 10000),
  metadata         jsonb not null default '{}'::jsonb,
  occurred_at      timestamptz not null default now(),
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index activities_lead_idx on public.activities (lead_id, occurred_at desc);

-- -----------------------------------------------------------------------------
-- Funções de acesso por lead
-- -----------------------------------------------------------------------------
create or replace function private.can_read_lead(p_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead
      and l.organization_id = private.org_id()
      and l.deleted_at is null
      and (private.can('crm.leads.read', l.owner_id)
           -- quem é responsável por um negócio do lead também enxerga o lead
           or exists (select 1 from public.deals d where d.lead_id = l.id and d.deleted_at is null
                        and private.can('crm.leads.read', d.owner_id)))
  );
$$;

create or replace function private.can_edit_lead(p_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead and l.organization_id = private.org_id() and l.deleted_at is null
      and private.can('crm.leads.update', l.owner_id)
  );
$$;

grant execute on function private.can_read_lead(uuid), private.can_edit_lead(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Regras de escrita em leads
-- -----------------------------------------------------------------------------
create or replace function private.leads_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- migrations, seeds, service role e RPCs que já validaram a operação
  if auth.uid() is null or current_setting('hub.trusted_op', true) = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.owner_id is distinct from auth.uid() and not private.has_perm('crm.leads.assign') then
      new.owner_id := auth.uid();
    end if;
    return new;
  end if;

  if new.owner_id is distinct from old.owner_id and not private.has_perm('crm.leads.assign') then
    raise exception 'Você não tem permissão para trocar o responsável.' using errcode = '42501';
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    if not private.can('crm.leads.delete', old.owner_id) then
      raise exception 'Você não tem permissão para excluir leads.' using errcode = '42501';
    end if;
    new.deleted_by := auth.uid();
  end if;
  if new.organization_id <> old.organization_id then
    raise exception 'Operação inválida.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger leads_guard before insert or update on public.leads
  for each row execute function private.leads_guard();

create trigger audit_leads after update or delete on public.leads
  for each row execute function private.audit_row('email,phone_e164,phone_raw,whatsapp_e164', 'owner_id,status,deleted_at,name');

-- -----------------------------------------------------------------------------
-- Regras dos negócios: organização, etapa do mesmo funil, histórico, ganho/perda
-- -----------------------------------------------------------------------------
create or replace function private.deals_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage record;
begin
  select s.pipeline_id, s.kind, s.organization_id into v_stage from public.stages s where s.id = new.stage_id;
  if v_stage.pipeline_id is distinct from new.pipeline_id then
    raise exception 'A etapa não pertence a este funil.' using errcode = 'P0001';
  end if;
  if (select organization_id from public.leads where id = new.lead_id) is distinct from new.organization_id
     or v_stage.organization_id <> new.organization_id then
    raise exception 'Operação inválida.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    if tg_op = 'UPDATE' and auth.uid() is not null and not private.can('crm.pipeline.move', old.owner_id) then
      raise exception 'Você não tem permissão para mover este negócio no funil.' using errcode = '42501';
    end if;
    new.stage_changed_at := now();
    new.won_at := case when v_stage.kind = 'won' then coalesce(new.won_at, now()) end;
    new.lost_at := case when v_stage.kind = 'lost' then coalesce(new.lost_at, now()) end;
    if v_stage.kind <> 'lost' then
      new.lost_reason_id := null;
      new.lost_note := null;
    end if;
  end if;

  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id
     and auth.uid() is not null and not private.has_perm('crm.leads.assign') then
    raise exception 'Você não tem permissão para trocar o responsável.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger deals_before before insert or update on public.deals
  for each row execute function private.deals_before();

create or replace function private.deals_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text;
  v_to text;
begin
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    insert into public.deal_stage_history (organization_id, deal_id, from_stage_id, to_stage_id, moved_by)
    values (new.organization_id, new.id, case when tg_op = 'UPDATE' then old.stage_id end, new.stage_id, auth.uid());

    if tg_op = 'UPDATE' then
      select name into v_from from public.stages where id = old.stage_id;
      select name into v_to from public.stages where id = new.stage_id;
      insert into public.activities (organization_id, lead_id, deal_id, type, content, metadata, created_by)
      values (new.organization_id, new.lead_id, new.id, 'mudanca_etapa',
              format('Movido de “%s” para “%s”', v_from, v_to),
              jsonb_build_object('from', old.stage_id, 'to', new.stage_id), auth.uid());
    end if;
  end if;
  return null;
end;
$$;

create trigger deals_after after insert or update on public.deals
  for each row execute function private.deals_after();

create trigger audit_deals after update or delete on public.deals
  for each row execute function private.audit_row('', 'owner_id,amount_cents,deleted_at,lost_reason_id');

-- Interação registrada atualiza o "último contato" do lead.
create or replace function private.activities_touch_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type in ('whatsapp', 'ligacao', 'email', 'reuniao') then
    update public.leads set last_contact_at = greatest(coalesce(last_contact_at, new.occurred_at), new.occurred_at)
    where id = new.lead_id;
  end if;
  return null;
end;
$$;

create trigger activities_touch_lead after insert on public.activities
  for each row execute function private.activities_touch_lead();

-- -----------------------------------------------------------------------------
-- RPC: mover negócio (etapa + posição) com motivo de perda
-- -----------------------------------------------------------------------------
create or replace function public.move_deal(
  p_deal uuid, p_stage uuid, p_position double precision,
  p_lost_reason uuid default null, p_lost_note text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_kind public.stage_kind;
begin
  select kind into v_kind from public.stages where id = p_stage;
  if v_kind = 'lost' and p_lost_reason is null then
    raise exception 'Informe o motivo da perda.' using errcode = 'P0001', hint = 'lost_reason_required';
  end if;

  update public.deals
     set stage_id = p_stage,
         position = p_position,
         lost_reason_id = case when v_kind = 'lost' then p_lost_reason end,
         lost_note = case when v_kind = 'lost' then nullif(trim(p_lost_note), '') end
   where id = p_deal and deleted_at is null;
  if not found then
    raise exception 'Negócio não encontrado ou sem permissão.' using errcode = 'P0002';
  end if;
end;
$$;

grant execute on function public.move_deal(uuid, uuid, double precision, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- RPC: importação de leads (linhas já mapeadas e validadas no cliente;
-- o banco revalida pelas constraints). Duplicados por place_id, telefone ou e-mail.
-- p_mode: 'skip' (ignora duplicados) | 'update' (completa campos vazios)
-- -----------------------------------------------------------------------------
create or replace function public.import_leads(
  p_file_name text, p_rows jsonb, p_pipeline uuid, p_mode text default 'skip', p_segment_name text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := private.org_id();
  v_import uuid;
  v_stage uuid;
  v_segment uuid;
  v_row jsonb;
  v_existing uuid;
  v_lead uuid;
  v_ins int := 0;
  v_upd int := 0;
  v_skip int := 0;
  v_bad int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_idx int := 0;
begin
  if not private.has_perm('crm.leads.import') then
    raise exception 'Você não tem permissão para importar leads.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 10000 then
    raise exception 'Envie no máximo 10.000 linhas por importação.' using errcode = 'P0001';
  end if;

  select id into v_stage from public.stages
   where pipeline_id = p_pipeline and organization_id = v_org and kind = 'open'
   order by position limit 1;
  if v_stage is null then
    raise exception 'Funil inválido.' using errcode = 'P0002';
  end if;

  if nullif(trim(p_segment_name), '') is not null then
    insert into public.segments (organization_id, name) values (v_org, trim(p_segment_name))
    on conflict (organization_id, lower(name)) do nothing;
    select id into v_segment from public.segments where organization_id = v_org and lower(name) = lower(trim(p_segment_name));
  end if;

  insert into public.imports (organization_id, file_name, total_rows)
  values (v_org, left(p_file_name, 200), jsonb_array_length(p_rows))
  returning id into v_import;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    begin
      v_existing := null;
      select id into v_existing from public.leads l
       where l.organization_id = v_org and l.deleted_at is null
         and ((v_row ->> 'place_id' is not null and l.place_id = v_row ->> 'place_id')
           or (v_row ->> 'phone_e164' is not null and l.phone_e164 = v_row ->> 'phone_e164')
           or (v_row ->> 'email' is not null and lower(l.email) = lower(v_row ->> 'email')))
       limit 1;

      if v_existing is not null then
        if p_mode = 'update' then
          update public.leads l set
            company_name = coalesce(l.company_name, v_row ->> 'company_name'),
            email = coalesce(l.email, v_row ->> 'email'),
            website = coalesce(l.website, v_row ->> 'website'),
            instagram = coalesce(l.instagram, v_row ->> 'instagram'),
            facebook = coalesce(l.facebook, v_row ->> 'facebook'),
            linkedin = coalesce(l.linkedin, v_row ->> 'linkedin'),
            address = coalesce(l.address, v_row ->> 'address'),
            neighborhood = coalesce(l.neighborhood, v_row ->> 'neighborhood'),
            city = coalesce(l.city, v_row ->> 'city'),
            state = coalesce(l.state, v_row ->> 'state'),
            zip = coalesce(l.zip, v_row ->> 'zip'),
            gmb_url = coalesce(l.gmb_url, v_row ->> 'gmb_url'),
            gmb_rating = coalesce((v_row ->> 'gmb_rating')::numeric, l.gmb_rating),
            gmb_reviews_count = coalesce((v_row ->> 'gmb_reviews_count')::int, l.gmb_reviews_count),
            segment_id = coalesce(l.segment_id, v_segment)
          where l.id = v_existing;
          v_upd := v_upd + 1;
        else
          v_skip := v_skip + 1;
        end if;
        continue;
      end if;

      insert into public.leads (
        organization_id, name, company_name, phone_raw, phone_e164, phone_type, whatsapp_e164, email,
        website, instagram, facebook, linkedin, address, neighborhood, city, state, zip, lat, lng,
        place_id, gmb_url, gmb_rating, gmb_reviews_count, category, segment_id, source, notes, import_id
      ) values (
        v_org, v_row ->> 'name', v_row ->> 'company_name', v_row ->> 'phone_raw', v_row ->> 'phone_e164',
        v_row ->> 'phone_type', v_row ->> 'whatsapp_e164', v_row ->> 'email', v_row ->> 'website',
        v_row ->> 'instagram', v_row ->> 'facebook', v_row ->> 'linkedin', v_row ->> 'address',
        v_row ->> 'neighborhood', v_row ->> 'city', v_row ->> 'state', v_row ->> 'zip',
        (v_row ->> 'lat')::double precision, (v_row ->> 'lng')::double precision,
        v_row ->> 'place_id', v_row ->> 'gmb_url', (v_row ->> 'gmb_rating')::numeric,
        (v_row ->> 'gmb_reviews_count')::int, v_row ->> 'category', v_segment, coalesce(v_row ->> 'source', 'Importação'),
        v_row ->> 'notes', v_import
      ) returning id into v_lead;

      insert into public.deals (organization_id, lead_id, pipeline_id, stage_id, position)
      values (v_org, v_lead, p_pipeline, v_stage, v_idx * 1024);

      v_ins := v_ins + 1;
    exception when others then
      v_bad := v_bad + 1;
      v_errors := v_errors || jsonb_build_object('linha', coalesce((v_row ->> '_line')::int, v_idx), 'erro', sqlerrm);
    end;
  end loop;

  insert into public.activities (organization_id, lead_id, type, content, metadata)
  select v_org, l.id, 'importacao', format('Importado de “%s”', p_file_name), jsonb_build_object('import_id', v_import)
  from public.leads l where l.import_id = v_import;

  update public.imports
     set inserted = v_ins, updated = v_upd, skipped = v_skip, invalid = v_bad,
         report = jsonb_build_object('errors', v_errors)
   where id = v_import;

  return jsonb_build_object('import_id', v_import, 'inserted', v_ins, 'updated', v_upd,
                            'skipped', v_skip, 'invalid', v_bad, 'errors', v_errors);
end;
$$;

grant execute on function public.import_leads(text, jsonb, uuid, text, text) to authenticated;

-- Verificação prévia de duplicados contra o banco (para o passo de validação).
create or replace function public.find_existing_leads(p_place_ids text[], p_phones text[], p_emails text[])
returns table (id uuid, name text, place_id text, phone_e164 text, email text)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.id, l.name, l.place_id, l.phone_e164, l.email
  from public.leads l
  where l.organization_id = private.org_id() and l.deleted_at is null
    and (l.place_id = any (p_place_ids) or l.phone_e164 = any (p_phones) or lower(l.email) = any (p_emails));
$$;

grant execute on function public.find_existing_leads(text[], text[], text[]) to authenticated;

-- Desfaz uma importação (exclusão lógica dos leads criados por ela).
-- Quem importou (ou quem pode excluir leads) desfaz; RPC valida e marca a operação como confiável.
create or replace function public.undo_import(p_import uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
  v_imp record;
begin
  select organization_id, created_by, undone_at into v_imp from public.imports where id = p_import;
  if v_imp.organization_id is distinct from private.org_id() then
    raise exception 'Importação não encontrada.' using errcode = 'P0002';
  end if;
  if not (private.has_perm('crm.leads.import') and (v_imp.created_by = auth.uid() or private.has_perm('crm.leads.delete'))) then
    raise exception 'Você não tem permissão para desfazer esta importação.' using errcode = '42501';
  end if;
  if v_imp.undone_at is not null then
    raise exception 'Esta importação já foi desfeita.' using errcode = 'P0001';
  end if;

  perform set_config('hub.trusted_op', 'on', true);
  update public.leads set deleted_at = now(), deleted_by = auth.uid()
   where import_id = p_import and deleted_at is null;
  get diagnostics v_count = row_count;
  update public.deals set deleted_at = now()
   where lead_id in (select id from public.leads where import_id = p_import) and deleted_at is null;
  perform set_config('hub.trusted_op', 'off', true);

  update public.imports set undone_at = now() where id = p_import;
  perform private.log_event('undo_import', 'imports', p_import::text, jsonb_build_object('leads', v_count));
  return v_count;
end;
$$;

grant execute on function public.undo_import(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.segments enable row level security;
alter table public.tags enable row level security;
alter table public.pipelines enable row level security;
alter table public.stages enable row level security;
alter table public.lost_reasons enable row level security;
alter table public.message_templates enable row level security;
alter table public.imports enable row level security;
alter table public.import_mappings enable row level security;
alter table public.leads enable row level security;
alter table public.lead_tags enable row level security;
alter table public.deals enable row level security;
alter table public.deal_stage_history enable row level security;
alter table public.activities enable row level security;

-- Cadastros de apoio: leitura para a organização; escrita para quem configura o CRM.
do $$
declare t text;
begin
  foreach t in array array['segments', 'tags', 'pipelines', 'stages', 'lost_reasons', 'message_templates'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using (organization_id = (select private.org_id()));
    $f$, t);
  end loop;

  foreach t in array array['pipelines', 'stages', 'lost_reasons', 'message_templates'] loop
    execute format($f$
      create policy %1$s_write on public.%1$s for all to authenticated
        using (organization_id = (select private.org_id()) and (select private.has_perm('crm.pipeline.configure')))
        with check (organization_id = (select private.org_id()) and (select private.has_perm('crm.pipeline.configure')));
    $f$, t);
  end loop;
end $$;

-- Segmentos e etiquetas: quem edita leads pode criar.
create policy segments_insert on public.segments for insert to authenticated
  with check (organization_id = (select private.org_id())
              and ((select private.has_perm('crm.leads.update')) or (select private.has_perm('crm.leads.import'))));
create policy segments_manage on public.segments for update to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('crm.pipeline.configure')));
create policy segments_delete on public.segments for delete to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('crm.pipeline.configure')));

create policy tags_insert on public.tags for insert to authenticated
  with check (organization_id = (select private.org_id()) and (select private.has_perm('crm.leads.update')));
create policy tags_manage on public.tags for update to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('crm.pipeline.configure')));
create policy tags_delete on public.tags for delete to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('crm.pipeline.configure')));

-- Importações
create policy imports_select on public.imports for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('crm.leads.import')));
create policy imports_insert on public.imports for insert to authenticated
  with check (organization_id = (select private.org_id()) and (select private.has_perm('crm.leads.import')));
create policy imports_update on public.imports for update to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('crm.leads.import')));

create policy import_mappings_all on public.import_mappings for all to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('crm.leads.import')))
  with check (organization_id = (select private.org_id()) and (select private.has_perm('crm.leads.import')));

-- Leads
create policy leads_select on public.leads for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is null
         and (private.can('crm.leads.read', owner_id)
              or exists (select 1 from public.deals d where d.lead_id = leads.id and d.deleted_at is null
                           and private.can('crm.leads.read', d.owner_id))));
-- Leitura de excluídos (lixeira) para quem pode excluir.
create policy leads_select_trash on public.leads for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is not null
         and private.can('crm.leads.delete', owner_id));
create policy leads_insert on public.leads for insert to authenticated
  with check (organization_id = (select private.org_id())
              and ((select private.has_perm('crm.leads.create')) or (select private.has_perm('crm.leads.import'))));
create policy leads_update on public.leads for update to authenticated
  using (organization_id = (select private.org_id())
         and (private.can('crm.leads.update', owner_id) or private.can('crm.leads.delete', owner_id)))
  with check (organization_id = (select private.org_id()));

create policy lead_tags_select on public.lead_tags for select to authenticated
  using (private.can_read_lead(lead_id));
create policy lead_tags_write on public.lead_tags for all to authenticated
  using (private.can_edit_lead(lead_id))
  with check (private.can_edit_lead(lead_id)
              and exists (select 1 from public.tags t where t.id = tag_id and t.organization_id = (select private.org_id())));

-- Negócios
create policy deals_select on public.deals for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is null
         and (private.can('crm.leads.read', owner_id) or private.can_read_lead(lead_id)));
create policy deals_insert on public.deals for insert to authenticated
  with check (organization_id = (select private.org_id())
              and ((select private.has_perm('crm.leads.create')) or (select private.has_perm('crm.leads.import'))));
create policy deals_update on public.deals for update to authenticated
  using (organization_id = (select private.org_id())
         and (private.can('crm.pipeline.move', owner_id) or private.can('crm.leads.update', owner_id)))
  with check (organization_id = (select private.org_id()));

create policy deal_stage_history_select on public.deal_stage_history for select to authenticated
  using (organization_id = (select private.org_id())
         and exists (select 1 from public.deals d where d.id = deal_id));

-- Interações: quem enxerga o lead pode registrar e ler a linha do tempo.
create policy activities_select on public.activities for select to authenticated
  using (organization_id = (select private.org_id()) and private.can_read_lead(lead_id));
create policy activities_insert on public.activities for insert to authenticated
  with check (organization_id = (select private.org_id()) and private.can_read_lead(lead_id)
              and created_by = (select auth.uid()));
create policy activities_delete_own on public.activities for delete to authenticated
  using (created_by = (select auth.uid()) and type in ('nota', 'whatsapp', 'ligacao', 'email', 'reuniao'));

-- -----------------------------------------------------------------------------
-- Dados iniciais do CRM
-- -----------------------------------------------------------------------------
create or replace function private.seed_crm(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site uuid;
  v_traffic uuid;
begin
  if exists (select 1 from public.pipelines where organization_id = p_org) then
    return;
  end if;

  insert into public.pipelines (organization_id, name, position) values (p_org, 'Venda de site', 0) returning id into v_site;
  insert into public.pipelines (organization_id, name, position) values (p_org, 'Tráfego pago', 1) returning id into v_traffic;

  insert into public.stages (organization_id, pipeline_id, name, position, color, kind, sla_days) values
    (p_org, v_site, 'Lead importado',      0,  'slate',  'open', 7),
    (p_org, v_site, 'Cliente analisado',   1,  'blue',   'open', 3),
    (p_org, v_site, 'Iniciando o site',    2,  'violet', 'open', 5),
    (p_org, v_site, 'Site pronto',         3,  'violet', 'open', 3),
    (p_org, v_site, 'Primeira prospecção', 4,  'teal',   'open', 2),
    (p_org, v_site, 'Cadência de contato', 5,  'teal',   'open', 7),
    (p_org, v_site, 'Reunião marcada',     6,  'amber',  'open', 3),
    (p_org, v_site, 'Proposta enviada',    7,  'orange', 'open', 5),
    (p_org, v_site, 'Negociação',          8,  'orange', 'open', 7),
    (p_org, v_site, 'Cliente fechado',     9,  'green',  'won',  null),
    (p_org, v_site, 'Perdido',             10, 'rose',   'lost', null),
    (p_org, v_traffic, 'Oferecer tráfego', 0,  'slate',  'open', 7),
    (p_org, v_traffic, 'Apresentado',      1,  'blue',   'open', 5),
    (p_org, v_traffic, 'Proposta enviada', 2,  'orange', 'open', 5),
    (p_org, v_traffic, 'Negociação',       3,  'orange', 'open', 7),
    (p_org, v_traffic, 'Contratou',        4,  'green',  'won',  null),
    (p_org, v_traffic, 'Não contratou',    5,  'rose',   'lost', null);

  insert into public.lost_reasons (organization_id, name, position) values
    (p_org, 'Sem interesse', 0),
    (p_org, 'Preço', 1),
    (p_org, 'Já tem fornecedor', 2),
    (p_org, 'Sem resposta', 3),
    (p_org, 'Telefone inválido', 4),
    (p_org, 'Fora do perfil', 5),
    (p_org, 'Fechou com concorrente', 6),
    (p_org, 'Outro', 7);

  insert into public.message_templates (organization_id, name, body, position) values
    (p_org, 'Primeiro contato',
     'Olá, {nome}! Tudo bem? Aqui é {responsavel}. Vi a {empresa} no Google e preparei uma ideia de site para vocês. Posso te mostrar?', 0),
    (p_org, 'Site pronto',
     'Oi, {nome}! O site da {empresa} que montei como demonstração ficou pronto. Quer ver como ficou? Leva 2 minutinhos.', 1),
    (p_org, 'Retomar contato',
     'Olá, {nome}! Passando para saber se conseguiu ver a proposta para a {empresa}. Fico à disposição para tirar dúvidas.', 2),
    (p_org, 'Confirmar reunião',
     'Oi, {nome}! Confirmando nossa conversa sobre o site da {empresa}. Combinado?', 3);
end;
$$;

select private.seed_crm(id) from public.organizations;

insert into supabase_migrations.schema_migrations (version, name) values ('20261031000300', 'crm') on conflict do nothing;

-- ===== supabase/migrations/20261031000400_tasks_calendar.sql
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

create or replace function private.can_manage_event(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.calendar_events e
    where e.id = p_event and e.organization_id = private.org_id()
      and e.deleted_at is null and private.can('calendar.manage', e.owner_id)
  );
$$;
revoke all on function private.can_manage_event(uuid) from public, anon;
grant execute on function private.can_manage_event(uuid) to authenticated;

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
create policy event_attendees_insert on public.event_attendees for insert to authenticated
  with check (private.can_manage_event(event_id));
create policy event_attendees_update on public.event_attendees for update to authenticated
  using (private.can_manage_event(event_id))
  with check (private.can_manage_event(event_id));
create policy event_attendees_delete on public.event_attendees for delete to authenticated
  using (private.can_manage_event(event_id));

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

insert into supabase_migrations.schema_migrations (version, name) values ('20261031000400', 'tasks_calendar') on conflict do nothing;

-- ===== supabase/migrations/20261031000500_clients_contracts.sql
-- =============================================================================
-- Fase 4 · Serviços, clientes, contratos, anexos e conversão de lead
-- O cliente É o lead convertido (clients.lead_id único): contatos, etiquetas e
-- linha do tempo continuam no lead, sem duplicar dados.
-- =============================================================================

create type public.service_kind as enum ('site', 'manutencao', 'meta_ads', 'google_ads', 'outro');
create type public.contract_status as enum ('rascunho', 'ativo', 'pausado', 'encerrado', 'cancelado');
create type public.recurrence as enum ('unica', 'mensal', 'trimestral', 'semestral', 'anual');
create type public.payment_method as enum ('pix', 'boleto', 'cartao_credito', 'cartao_debito', 'transferencia', 'dinheiro', 'outro');

create table public.services (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  name                 text not null check (char_length(name) between 2 and 80),
  kind                 public.service_kind not null default 'outro',
  is_recurring         boolean not null default false,
  default_price_cents  bigint check (default_price_cents >= 0),
  is_active            boolean not null default true,
  created_at           timestamptz not null default now()
);
create unique index services_org_name_uq on public.services (organization_id, lower(name));

create table public.clients (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  lead_id             uuid not null unique references public.leads (id) on delete restrict,
  legal_name          text check (char_length(legal_name) <= 200),
  document            text check (document ~ '^([0-9]{11}|[0-9]{14})$'),
  billing_email       text check (billing_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  billing_phone_e164  text check (billing_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  owner_id            uuid default auth.uid() references public.profiles (id) on delete set null,
  status              text not null default 'ativo' check (status in ('ativo', 'inativo')),
  notes               text check (char_length(notes) <= 10000),
  converted_at        timestamptz not null default now(),
  converted_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create index clients_org_owner_idx on public.clients (organization_id, owner_id) where deleted_at is null;
create trigger clients_updated_at before update on public.clients
  for each row execute function private.set_updated_at();

create table public.contracts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  client_id         uuid not null references public.clients (id) on delete restrict,
  service_id        uuid references public.services (id) on delete set null,
  deal_id           uuid references public.deals (id) on delete set null,
  owner_id          uuid default auth.uid() references public.profiles (id) on delete set null,
  title             text not null check (char_length(title) between 2 and 160),
  description       text check (char_length(description) <= 10000),
  amount_cents      bigint not null check (amount_cents >= 0),
  payment_method    public.payment_method not null default 'pix',
  recurrence        public.recurrence not null default 'unica',
  start_date        date not null,
  end_date          date,
  due_day           int check (due_day between 1 and 31),
  status            public.contract_status not null default 'ativo',
  notes             text check (char_length(notes) <= 10000),
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  check (end_date is null or end_date >= start_date)
);
create index contracts_client_idx on public.contracts (client_id) where deleted_at is null;
create index contracts_org_status_idx on public.contracts (organization_id, status) where deleted_at is null;
create index contracts_owner_idx on public.contracts (owner_id);
create trigger contracts_updated_at before update on public.contracts
  for each row execute function private.set_updated_at();

-- Vínculos opcionais de tarefas e eventos com cliente/contrato.
alter table public.tasks add column client_id uuid references public.clients (id) on delete set null;
alter table public.tasks add column contract_id uuid references public.contracts (id) on delete set null;
alter table public.calendar_events add column client_id uuid references public.clients (id) on delete set null;
alter table public.calendar_events add column contract_id uuid references public.contracts (id) on delete set null;
alter table public.activities add column client_id uuid references public.clients (id) on delete set null;
alter table public.activities add column contract_id uuid references public.contracts (id) on delete set null;
create index tasks_client_idx on public.tasks (client_id) where deleted_at is null;
create index tasks_contract_idx on public.tasks (contract_id) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- Acesso
-- -----------------------------------------------------------------------------
create or replace function private.can_read_client(p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clients c
    where c.id = p_client and c.organization_id = private.org_id() and c.deleted_at is null
      and (private.can('clients.read', c.owner_id) or private.can_read_lead(c.lead_id))
  );
$$;

create or replace function private.can_read_contract(p_contract uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.contracts k
    where k.id = p_contract and k.organization_id = private.org_id() and k.deleted_at is null
      and (private.can('contracts.read', k.owner_id)
           or (private.perm_scope('contracts.read') is not null and private.can_read_client(k.client_id)))
  );
$$;

grant execute on function private.can_read_client(uuid), private.can_read_contract(uuid) to authenticated;

-- Contratos: auditoria completa (valores, datas, situação, responsável).
create trigger audit_contracts after insert or update or delete on public.contracts
  for each row execute function private.audit_row();
create trigger audit_clients after update or delete on public.clients
  for each row execute function private.audit_row('document,billing_email,billing_phone_e164', 'owner_id,status,deleted_at,legal_name,document');

create or replace function private.contracts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or current_setting('hub.trusted_op', true) = 'on' then
    return new;
  end if;
  if not private.can_read_client(new.client_id) then
    raise exception 'Cliente não encontrado.' using errcode = '42501';
  end if;
  if new.deleted_at is not null and (tg_op = 'INSERT' or old.deleted_at is null)
     and not private.can('contracts.delete', coalesce(old.owner_id, new.owner_id)) then
    raise exception 'Você não tem permissão para excluir contratos.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger contracts_guard before insert or update on public.contracts
  for each row execute function private.contracts_guard();

-- -----------------------------------------------------------------------------
-- Conversão de lead em cliente (transação única)
-- -----------------------------------------------------------------------------
create or replace function public.convert_lead(
  p_lead uuid,
  p_deal uuid,
  p_legal_name text,
  p_document text,
  p_billing_email text,
  p_billing_phone text,
  p_contract jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := private.org_id();
  v_client uuid;
  v_contract uuid;
  v_won uuid;
  v_lead record;
begin
  if not private.has_perm('clients.create') then
    raise exception 'Você não tem permissão para converter leads.' using errcode = '42501';
  end if;
  select id, name, owner_id, status into v_lead from public.leads where id = p_lead and deleted_at is null;
  if v_lead.id is null then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.clients where lead_id = p_lead) then
    raise exception 'Este lead já é cliente.' using errcode = 'P0001', hint = 'already_client';
  end if;

  insert into public.clients (organization_id, lead_id, legal_name, document, billing_email, billing_phone_e164, owner_id)
  values (v_org, p_lead, nullif(trim(p_legal_name), ''), nullif(regexp_replace(coalesce(p_document, ''), '\D', '', 'g'), ''),
          nullif(lower(trim(p_billing_email)), ''), nullif(trim(p_billing_phone), ''), coalesce(v_lead.owner_id, auth.uid()))
  returning id into v_client;

  update public.leads set status = 'cliente' where id = p_lead;

  -- Negócio vai para a etapa de ganho do seu funil.
  if p_deal is not null then
    select s.id into v_won from public.deals d join public.stages s on s.pipeline_id = d.pipeline_id and s.kind = 'won'
     where d.id = p_deal order by s.position limit 1;
    if v_won is not null then
      update public.deals set stage_id = v_won where id = p_deal and stage_id <> v_won;
    end if;
  end if;

  if p_contract is not null then
    insert into public.contracts (organization_id, client_id, service_id, deal_id, owner_id, title, description, amount_cents,
                                  payment_method, recurrence, start_date, end_date, due_day, status)
    values (v_org, v_client, nullif(p_contract ->> 'service_id', '')::uuid, p_deal, coalesce(v_lead.owner_id, auth.uid()),
            p_contract ->> 'title', nullif(p_contract ->> 'description', ''), (p_contract ->> 'amount_cents')::bigint,
            coalesce(nullif(p_contract ->> 'payment_method', ''), 'pix')::public.payment_method,
            coalesce(nullif(p_contract ->> 'recurrence', ''), 'unica')::public.recurrence,
            (p_contract ->> 'start_date')::date, nullif(p_contract ->> 'end_date', '')::date,
            nullif(p_contract ->> 'due_day', '')::int, 'ativo')
    returning id into v_contract;
  end if;

  insert into public.activities (organization_id, lead_id, deal_id, client_id, contract_id, type, content)
  values (v_org, p_lead, p_deal, v_client, v_contract, 'sistema', 'Convertido em cliente');

  perform private.log_event('convert_lead', 'leads', p_lead::text,
                            jsonb_build_object('client_id', v_client, 'contract_id', v_contract, 'deal_id', p_deal));

  return jsonb_build_object('client_id', v_client, 'contract_id', v_contract);
end;
$$;

grant execute on function public.convert_lead(uuid, uuid, text, text, text, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Anexos (metadados) + Storage privado
-- Caminho: {organization_id}/{entity_type}/{entity_id}/{uuid}-{nome}
-- -----------------------------------------------------------------------------
create table public.attachments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  entity_type      text not null check (entity_type in ('lead', 'client', 'contract', 'task', 'transaction')),
  entity_id        uuid not null,
  storage_path     text not null unique,
  file_name        text not null check (char_length(file_name) between 1 and 200),
  mime_type        text not null,
  size_bytes       bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  uploaded_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index attachments_entity_idx on public.attachments (entity_type, entity_id) where deleted_at is null;

-- Substituída na Fase 5 para incluir lançamentos financeiros.
create or replace function private.can_access_entity(p_type text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_type
    when 'lead' then private.can_read_lead(p_id)
    when 'client' then private.can_read_client(p_id)
    when 'contract' then private.can_read_contract(p_id)
    when 'task' then private.can_read_task(p_id)
    else false
  end;
$$;

grant execute on function private.can_access_entity(text, uuid) to authenticated;

create trigger audit_attachments after update or delete on public.attachments
  for each row execute function private.audit_row('', 'deleted_at');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 15728640, array[
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv', 'text/plain'
])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Extrai a entidade do caminho do arquivo e reaproveita a mesma regra de acesso.
create or replace function private.storage_entity_ok(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (storage.foldername(p_name))[1] = private.org_id()::text
     and (storage.foldername(p_name))[3] ~ '^[0-9a-f-]{36}$'
     and private.can_access_entity((storage.foldername(p_name))[2], ((storage.foldername(p_name))[3])::uuid);
$$;

grant execute on function private.storage_entity_ok(text) to authenticated;

create policy attachments_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and private.storage_entity_ok(name));
create policy attachments_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and private.storage_entity_ok(name));
create policy attachments_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and private.storage_entity_ok(name) and owner_id = (select auth.uid())::text);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.services enable row level security;
alter table public.clients enable row level security;
alter table public.contracts enable row level security;
alter table public.attachments enable row level security;

create policy services_select on public.services for select to authenticated
  using (organization_id = (select private.org_id()));
create policy services_write on public.services for all to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('admin.settings')))
  with check (organization_id = (select private.org_id()) and (select private.has_perm('admin.settings')));

create policy clients_select on public.clients for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is null
         and (private.can('clients.read', owner_id) or private.can_read_lead(lead_id)));
create policy clients_insert on public.clients for insert to authenticated
  with check (organization_id = (select private.org_id()) and (select private.has_perm('clients.create'))
              and private.can_read_lead(lead_id));
create policy clients_update on public.clients for update to authenticated
  using (organization_id = (select private.org_id())
         and (private.can('clients.update', owner_id) or private.can('clients.delete', owner_id)))
  with check (organization_id = (select private.org_id()));

create policy contracts_select on public.contracts for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is null
         and (private.can('contracts.read', owner_id)
              or ((select private.perm_scope('contracts.read')) is not null and private.can_read_client(client_id))));
create policy contracts_insert on public.contracts for insert to authenticated
  with check (organization_id = (select private.org_id()) and (select private.has_perm('contracts.create')));
create policy contracts_update on public.contracts for update to authenticated
  using (organization_id = (select private.org_id())
         and (private.can('contracts.update', owner_id) or private.can('contracts.delete', owner_id)))
  with check (organization_id = (select private.org_id()));

create policy attachments_select on public.attachments for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is null and private.can_access_entity(entity_type, entity_id));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (organization_id = (select private.org_id()) and private.can_access_entity(entity_type, entity_id)
              and uploaded_by = (select auth.uid())
              and storage_path like (select private.org_id())::text || '/' || entity_type || '/' || entity_id::text || '/%');
create policy attachments_update on public.attachments for update to authenticated
  using (organization_id = (select private.org_id()) and private.can_access_entity(entity_type, entity_id)
         and (uploaded_by = (select auth.uid()) or (select private.has_perm('admin.data_export'))));

-- -----------------------------------------------------------------------------
-- Serviços iniciais
-- -----------------------------------------------------------------------------
insert into public.services (organization_id, name, kind, is_recurring)
select o.id, s.name, s.kind::public.service_kind, s.rec
from public.organizations o
cross join (values
  ('Criação de site', 'site', false),
  ('Manutenção de site', 'manutencao', true),
  ('Meta Ads', 'meta_ads', true),
  ('Google Ads', 'google_ads', true),
  ('Google Meu Negócio', 'outro', false),
  ('Outros serviços', 'outro', false)
) as s(name, kind, rec)
on conflict do nothing;

insert into supabase_migrations.schema_migrations (version, name) values ('20261031000500', 'clients_contracts') on conflict do nothing;

-- ===== supabase/migrations/20261031000600_finance.sql
-- =============================================================================
-- Fase 5 · Financeiro (pessoal × empresa)
-- * scope = 'empresa' | 'pessoal' em contas, categorias, recorrências e lançamentos.
-- * Pessoal: só o dono lê/escreve. O administrador consulta apenas pela RPC
--   admin_read_personal_finance, que registra a consulta na auditoria.
-- * Dinheiro em centavos (bigint). "Vencido" é derivado (due_date < hoje e não pago).
-- =============================================================================

create type public.finance_scope as enum ('empresa', 'pessoal');
create type public.txn_kind as enum ('receita', 'despesa', 'transferencia');
create type public.txn_status as enum ('previsto', 'pago', 'cancelado');
create type public.account_type as enum ('corrente', 'poupanca', 'cartao', 'dinheiro', 'investimento', 'outro');
create type public.frequency as enum ('semanal', 'mensal', 'trimestral', 'semestral', 'anual');

create table public.financial_accounts (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  scope                  public.finance_scope not null,
  owner_user_id          uuid references public.profiles (id) on delete cascade,
  name                   text not null check (char_length(name) between 2 and 80),
  type                   public.account_type not null default 'corrente',
  opening_balance_cents  bigint not null default 0,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  check ((scope = 'pessoal') = (owner_user_id is not null))
);
create index financial_accounts_scope_idx on public.financial_accounts (organization_id, scope, owner_user_id);

create table public.financial_categories (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  scope            public.finance_scope not null,
  owner_user_id    uuid references public.profiles (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 80),
  kind             public.txn_kind not null check (kind in ('receita', 'despesa')),
  parent_id        uuid references public.financial_categories (id) on delete set null,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  check ((scope = 'pessoal') = (owner_user_id is not null))
);
create index financial_categories_scope_idx on public.financial_categories (organization_id, scope, owner_user_id);

create table public.cost_centers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 80),
  is_active        boolean not null default true
);

create table public.financial_recurrences (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  scope             public.finance_scope not null,
  owner_user_id     uuid references public.profiles (id) on delete cascade,
  frequency         public.frequency not null default 'mensal',
  start_date        date not null,
  end_date          date,
  template          jsonb not null,           -- kind, description, amount_cents, category_id, account_id, ...
  generated_until   date,
  is_active         boolean not null default true,
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  check ((scope = 'pessoal') = (owner_user_id is not null)),
  check (end_date is null or end_date >= start_date)
);

create table public.financial_transactions (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  scope                 public.finance_scope not null,
  owner_user_id         uuid references public.profiles (id) on delete cascade,
  kind                  public.txn_kind not null,
  description           text not null check (char_length(description) between 1 and 200),
  amount_cents          bigint not null check (amount_cents > 0),
  category_id           uuid references public.financial_categories (id) on delete set null,
  cost_center_id        uuid references public.cost_centers (id) on delete set null,
  account_id            uuid references public.financial_accounts (id) on delete restrict,
  transfer_account_id   uuid references public.financial_accounts (id) on delete restrict,
  payment_method        public.payment_method,
  competence_date       date not null,
  due_date              date not null,
  paid_at               date,
  paid_amount_cents     bigint check (paid_amount_cents >= 0),
  status                public.txn_status not null default 'previsto',
  installment_group_id  uuid,
  installment_number    int check (installment_number >= 1),
  installment_total     int check (installment_total >= 1),
  recurrence_id         uuid references public.financial_recurrences (id) on delete set null,
  client_id             uuid references public.clients (id) on delete set null,
  contract_id           uuid references public.contracts (id) on delete set null,
  reconciled_at         timestamptz,
  reconciled_by         uuid references auth.users (id) on delete set null,
  notes                 text check (char_length(notes) <= 5000),
  created_by            uuid default auth.uid() references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  check ((scope = 'pessoal') = (owner_user_id is not null)),
  check (status <> 'pago' or paid_at is not null),
  check (kind <> 'transferencia' or (transfer_account_id is not null and account_id is not null and transfer_account_id <> account_id)),
  check (scope = 'empresa' or (client_id is null and contract_id is null and cost_center_id is null)),
  check (installment_number is null or installment_number <= installment_total)
);
create index fin_txn_scope_due_idx on public.financial_transactions (organization_id, scope, owner_user_id, due_date) where deleted_at is null;
create index fin_txn_account_idx on public.financial_transactions (account_id, paid_at) where deleted_at is null;
create index fin_txn_competence_idx on public.financial_transactions (organization_id, scope, competence_date) where deleted_at is null;
create index fin_txn_contract_idx on public.financial_transactions (contract_id) where deleted_at is null;
create index fin_txn_group_idx on public.financial_transactions (installment_group_id);
create unique index fin_txn_recurrence_uq on public.financial_transactions (recurrence_id, due_date) where recurrence_id is not null and deleted_at is null;
create unique index fin_txn_contract_due_uq on public.financial_transactions (contract_id, due_date) where contract_id is not null and recurrence_id is null and deleted_at is null and kind = 'receita';
create trigger financial_transactions_updated_at before update on public.financial_transactions
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Acesso por contexto
-- -----------------------------------------------------------------------------
create or replace function private.fin_can(p_scope public.finance_scope, p_owner uuid, p_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_scope
    when 'empresa' then private.has_perm('finance.company.' || p_action)
    when 'pessoal' then p_owner = auth.uid() and private.has_perm('finance.personal.manage')
  end;
$$;

grant execute on function private.fin_can(public.finance_scope, uuid, text) to authenticated;

create or replace function private.can_read_transaction(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.financial_transactions t
    where t.id = p_id and t.organization_id = private.org_id() and t.deleted_at is null
      and private.fin_can(t.scope, t.owner_user_id, 'read')
  );
$$;

grant execute on function private.can_read_transaction(uuid) to authenticated;

-- Anexos e comprovantes de lançamentos passam a usar a mesma regra.
create or replace function private.can_access_entity(p_type text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_type
    when 'lead' then private.can_read_lead(p_id)
    when 'client' then private.can_read_client(p_id)
    when 'contract' then private.can_read_contract(p_id)
    when 'task' then private.can_read_task(p_id)
    when 'transaction' then private.can_read_transaction(p_id)
    else false
  end;
$$;

-- Coerência: conta/categoria do mesmo contexto (e do mesmo dono, se pessoal);
-- pessoal sempre do usuário atual; conciliação exige permissão própria.
create or replace function private.fin_txn_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if auth.uid() is null or current_setting('hub.trusted_op', true) = 'on' then
    return new;
  end if;

  if new.scope = 'pessoal' then
    if new.owner_user_id is distinct from auth.uid() then
      raise exception 'Lançamentos pessoais pertencem apenas a quem os cria.' using errcode = '42501';
    end if;
  end if;

  if new.account_id is not null then
    select (a.scope = new.scope and a.owner_user_id is not distinct from new.owner_user_id) into v_ok
      from public.financial_accounts a where a.id = new.account_id;
    if not coalesce(v_ok, false) then
      raise exception 'A conta escolhida não pertence a este contexto financeiro.' using errcode = 'P0001';
    end if;
  end if;
  if new.transfer_account_id is not null then
    select (a.scope = new.scope and a.owner_user_id is not distinct from new.owner_user_id) into v_ok
      from public.financial_accounts a where a.id = new.transfer_account_id;
    if not coalesce(v_ok, false) then
      raise exception 'A conta de destino não pertence a este contexto financeiro.' using errcode = 'P0001';
    end if;
  end if;
  if new.category_id is not null then
    select (c.scope = new.scope and c.owner_user_id is not distinct from new.owner_user_id and (new.kind = 'transferencia' or c.kind = new.kind)) into v_ok
      from public.financial_categories c where c.id = new.category_id;
    if not coalesce(v_ok, false) then
      raise exception 'A categoria escolhida não combina com este lançamento.' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.scope <> old.scope or new.owner_user_id is distinct from old.owner_user_id then
      raise exception 'Não é possível mudar o contexto de um lançamento.' using errcode = 'P0001';
    end if;
    -- Sem "editar", só é possível conciliar ou excluir: nenhum outro campo pode mudar.
    if new.scope = 'empresa' and not private.has_perm('finance.company.update')
       and (to_jsonb(new) - array['reconciled_at', 'reconciled_by', 'deleted_at', 'updated_at'])
           <> (to_jsonb(old) - array['reconciled_at', 'reconciled_by', 'deleted_at', 'updated_at']) then
      raise exception 'Você não tem permissão para editar lançamentos da empresa.' using errcode = '42501';
    end if;
    if (new.reconciled_at is distinct from old.reconciled_at)
       and new.scope = 'empresa' and not private.has_perm('finance.company.reconcile') then
      raise exception 'Você não tem permissão para conciliar.' using errcode = '42501';
    end if;
    if new.reconciled_at is not null and new.reconciled_at is not distinct from old.reconciled_at
       and (new.amount_cents <> old.amount_cents or new.paid_at is distinct from old.paid_at
            or new.paid_amount_cents is distinct from old.paid_amount_cents or new.account_id is distinct from old.account_id) then
      raise exception 'Lançamento conciliado: desfaça a conciliação antes de alterar valores, data ou conta.' using errcode = 'P0001';
    end if;
    if new.reconciled_at is distinct from old.reconciled_at then
      new.reconciled_by := case when new.reconciled_at is null then null else auth.uid() end;
    end if;
    if new.scope = 'empresa' and new.deleted_at is not null and old.deleted_at is null
       and not private.has_perm('finance.company.delete') then
      raise exception 'Você não tem permissão para excluir lançamentos.' using errcode = '42501';
    end if;
  end if;

  if new.status = 'pago' then
    new.paid_amount_cents := coalesce(new.paid_amount_cents, new.amount_cents);
  elsif new.status <> 'pago' then
    new.paid_at := null;
    new.paid_amount_cents := null;
    new.reconciled_at := null;
  end if;
  return new;
end;
$$;

create trigger fin_txn_guard before insert or update on public.financial_transactions
  for each row execute function private.fin_txn_guard();

-- Auditoria: só o financeiro da empresa (o pessoal não vai para o log geral).
create trigger audit_fin_txn_update after update on public.financial_transactions
  for each row when (new.scope = 'empresa')
  execute function private.audit_row('', 'amount_cents,paid_amount_cents,paid_at,status,due_date,competence_date,account_id,category_id,reconciled_at,deleted_at');
create trigger audit_fin_txn_delete after delete on public.financial_transactions
  for each row when (old.scope = 'empresa') execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------

-- Inserção atômica de vários lançamentos (parcelas).
create or replace function public.create_transactions(p_rows jsonb)
returns setof uuid
language sql
security invoker
set search_path = ''
as $$
  insert into public.financial_transactions (
    scope, owner_user_id, kind, description, amount_cents, category_id, cost_center_id, account_id, transfer_account_id,
    payment_method, competence_date, due_date, paid_at, status, installment_group_id, installment_number, installment_total,
    client_id, contract_id, notes
  )
  select (r ->> 'scope')::public.finance_scope,
         case when r ->> 'scope' = 'pessoal' then auth.uid() end,
         (r ->> 'kind')::public.txn_kind, r ->> 'description', (r ->> 'amount_cents')::bigint,
         nullif(r ->> 'category_id', '')::uuid, nullif(r ->> 'cost_center_id', '')::uuid,
         nullif(r ->> 'account_id', '')::uuid, nullif(r ->> 'transfer_account_id', '')::uuid,
         nullif(r ->> 'payment_method', '')::public.payment_method,
         (r ->> 'competence_date')::date, (r ->> 'due_date')::date, nullif(r ->> 'paid_at', '')::date,
         coalesce(nullif(r ->> 'status', ''), 'previsto')::public.txn_status,
         nullif(r ->> 'installment_group_id', '')::uuid, nullif(r ->> 'installment_number', '')::int,
         nullif(r ->> 'installment_total', '')::int,
         nullif(r ->> 'client_id', '')::uuid, nullif(r ->> 'contract_id', '')::uuid, nullif(r ->> 'notes', '')
  from jsonb_array_elements(p_rows) r
  returning id;
$$;

grant execute on function public.create_transactions(jsonb) to authenticated;

-- Próxima data de uma recorrência.
create or replace function private.next_date(p_date date, p_freq public.frequency, p_anchor_day int)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_freq
    when 'semanal' then p_date + 7
    else (
      with m as (
        select date_trunc('month', p_date) + (case p_freq when 'mensal' then 1 when 'trimestral' then 3 when 'semestral' then 6 else 12 end) * interval '1 month' as base
      )
      select (base + (least(p_anchor_day, extract(day from (base + interval '1 month' - interval '1 day'))::int) - 1) * interval '1 day')::date from m
    )
  end;
$$;

-- Materializa ocorrências das recorrências visíveis ao usuário até p_until.
create or replace function public.generate_recurrences(p_until date default null)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_until date := coalesce(p_until, ((now() at time zone 'America/Sao_Paulo')::date + interval '12 months')::date);
  v_rec record;
  v_date date;
  v_count int := 0;
  v_anchor int;
begin
  for v_rec in
    select * from public.financial_recurrences r
     where r.is_active and coalesce(r.generated_until, r.start_date - 1) < v_until
       and private.fin_can(r.scope, r.owner_user_id, 'create')
  loop
    v_anchor := extract(day from v_rec.start_date)::int;
    v_date := case when v_rec.generated_until is null then v_rec.start_date else private.next_date(v_rec.generated_until, v_rec.frequency, v_anchor) end;
    while v_date <= v_until and (v_rec.end_date is null or v_date <= v_rec.end_date) loop
      insert into public.financial_transactions (
        scope, owner_user_id, kind, description, amount_cents, category_id, cost_center_id, account_id,
        payment_method, competence_date, due_date, status, recurrence_id, client_id, contract_id
      ) values (
        v_rec.scope, v_rec.owner_user_id, (v_rec.template ->> 'kind')::public.txn_kind, v_rec.template ->> 'description',
        (v_rec.template ->> 'amount_cents')::bigint, nullif(v_rec.template ->> 'category_id', '')::uuid,
        nullif(v_rec.template ->> 'cost_center_id', '')::uuid, nullif(v_rec.template ->> 'account_id', '')::uuid,
        nullif(v_rec.template ->> 'payment_method', '')::public.payment_method, v_date, v_date, 'previsto', v_rec.id,
        nullif(v_rec.template ->> 'client_id', '')::uuid, nullif(v_rec.template ->> 'contract_id', '')::uuid
      ) on conflict do nothing;
      v_count := v_count + 1;
      update public.financial_recurrences set generated_until = v_date where id = v_rec.id;
      v_date := private.next_date(v_date, v_rec.frequency, v_anchor);
    end loop;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.generate_recurrences(date) to authenticated;

-- Contrato → contas a receber (previstas). Recorrentes viram recorrência.
create or replace function public.contract_to_receivables(p_contract uuid, p_account uuid default null, p_category uuid default null)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_k record;
  v_first date;
  v_freq public.frequency;
  v_count int;
begin
  if not private.has_perm('finance.company.create') then
    raise exception 'Você não tem permissão para lançar no financeiro da empresa.' using errcode = '42501';
  end if;
  select k.*, c.lead_id into v_k from public.contracts k join public.clients c on c.id = k.client_id
   where k.id = p_contract and k.deleted_at is null;
  if v_k.id is null then
    raise exception 'Contrato não encontrado.' using errcode = 'P0002';
  end if;

  v_first := case when v_k.due_day is null then v_k.start_date
                  else make_date(extract(year from v_k.start_date)::int, extract(month from v_k.start_date)::int,
                                 least(v_k.due_day, extract(day from (date_trunc('month', v_k.start_date) + interval '1 month' - interval '1 day'))::int)) end;
  if v_first < v_k.start_date then
    v_first := private.next_date(v_first, 'mensal', coalesce(v_k.due_day, extract(day from v_first)::int));
  end if;

  if v_k.recurrence = 'unica' then
    insert into public.financial_transactions (scope, kind, description, amount_cents, category_id, account_id, payment_method,
      competence_date, due_date, status, client_id, contract_id)
    values ('empresa', 'receita', v_k.title, v_k.amount_cents, p_category, p_account, v_k.payment_method,
      v_k.start_date, v_first, 'previsto', v_k.client_id, v_k.id)
    on conflict do nothing;
    get diagnostics v_count = row_count;
    return v_count;
  end if;

  v_freq := case v_k.recurrence when 'mensal' then 'mensal' when 'trimestral' then 'trimestral' when 'semestral' then 'semestral' else 'anual' end::public.frequency;
  if exists (select 1 from public.financial_recurrences where template ->> 'contract_id' = p_contract::text and is_active) then
    raise exception 'As cobranças deste contrato já foram geradas.' using errcode = 'P0001';
  end if;
  insert into public.financial_recurrences (scope, frequency, start_date, end_date, template)
  values ('empresa', v_freq, v_first, v_k.end_date, jsonb_build_object(
    'kind', 'receita', 'description', v_k.title, 'amount_cents', v_k.amount_cents, 'category_id', coalesce(p_category::text, ''),
    'account_id', coalesce(p_account::text, ''), 'payment_method', v_k.payment_method, 'client_id', v_k.client_id, 'contract_id', v_k.id));
  return public.generate_recurrences(null);
end;
$$;

grant execute on function public.contract_to_receivables(uuid, uuid, uuid) to authenticated;

-- Resumo do contexto: saldos por conta e totais do período (RLS aplicada).
create or replace function public.finance_summary(p_scope public.finance_scope, p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with today as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  txn as (
    select * from public.financial_transactions t
    where t.scope = p_scope and t.deleted_at is null and t.status <> 'cancelado'
      and (p_scope = 'empresa' or t.owner_user_id = auth.uid())
  ),
  accounts as (
    select a.id, a.name, a.type, a.opening_balance_cents,
      a.opening_balance_cents
      + coalesce((select sum(case when t.kind = 'receita' then t.paid_amount_cents when t.kind = 'despesa' then -t.paid_amount_cents else -t.paid_amount_cents end)
                  from txn t where t.account_id = a.id and t.status = 'pago'), 0)
      + coalesce((select sum(t.paid_amount_cents) from txn t where t.transfer_account_id = a.id and t.kind = 'transferencia' and t.status = 'pago'), 0) as balance
    from public.financial_accounts a
    where a.scope = p_scope and a.is_active and (p_scope = 'empresa' or a.owner_user_id = auth.uid())
  )
  select jsonb_build_object(
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'type', type, 'balance', balance) order by name) from accounts), '[]'::jsonb),
    'balance', coalesce((select sum(balance) from accounts), 0),
    'income_paid', coalesce((select sum(paid_amount_cents) from txn where kind = 'receita' and status = 'pago' and paid_at between p_from and p_to), 0),
    'expense_paid', coalesce((select sum(paid_amount_cents) from txn where kind = 'despesa' and status = 'pago' and paid_at between p_from and p_to), 0),
    'income_competence', coalesce((select sum(amount_cents) from txn where kind = 'receita' and competence_date between p_from and p_to), 0),
    'expense_competence', coalesce((select sum(amount_cents) from txn where kind = 'despesa' and competence_date between p_from and p_to), 0),
    'receivable_open', coalesce((select sum(amount_cents) from txn, today where kind = 'receita' and status = 'previsto' and due_date >= today.d), 0),
    'payable_open', coalesce((select sum(amount_cents) from txn, today where kind = 'despesa' and status = 'previsto' and due_date >= today.d), 0),
    'receivable_overdue', coalesce((select sum(amount_cents) from txn, today where kind = 'receita' and status = 'previsto' and due_date < today.d), 0),
    'payable_overdue', coalesce((select sum(amount_cents) from txn, today where kind = 'despesa' and status = 'previsto' and due_date < today.d), 0),
    'overdue_count', (select count(*) from txn, today where status = 'previsto' and kind <> 'transferencia' and due_date < today.d)
  );
$$;

grant execute on function public.finance_summary(public.finance_scope, date, date) to authenticated;

-- Consulta do administrador ao financeiro pessoal de outra pessoa (auditada).
create or replace function public.admin_read_personal_finance(p_user uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.has_perm('finance.personal.admin_read') then
    raise exception 'Você não tem permissão para consultar o financeiro pessoal de outros usuários.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and organization_id = private.org_id()) then
    raise exception 'Usuário não encontrado.' using errcode = 'P0002';
  end if;
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'Escolha um período de até 13 meses.' using errcode = 'P0001';
  end if;

  perform private.log_event('admin_read_personal_finance', 'profiles', p_user::text,
                            jsonb_build_object('de', p_from, 'ate', p_to));

  select jsonb_build_object(
    'transactions', coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'kind', t.kind, 'description', t.description, 'amount_cents', t.amount_cents, 'status', t.status,
      'due_date', t.due_date, 'paid_at', t.paid_at, 'category', c.name, 'account', a.name) order by t.due_date desc), '[]'::jsonb)
  ) into v_result
  from public.financial_transactions t
  left join public.financial_categories c on c.id = t.category_id
  left join public.financial_accounts a on a.id = t.account_id
  where t.scope = 'pessoal' and t.owner_user_id = p_user and t.deleted_at is null
    and t.due_date between p_from and p_to;

  return v_result;
end;
$$;

grant execute on function public.admin_read_personal_finance(uuid, date, date) to authenticated;

-- O dono vê quem consultou o seu financeiro pessoal.
create or replace function public.my_personal_finance_reads()
returns table (actor_id uuid, actor_name text, read_at timestamptz, period jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select l.actor_id, p.full_name, l.created_at, l.changes
  from public.audit_logs l
  left join public.profiles p on p.id = l.actor_id
  where l.action = 'admin_read_personal_finance' and l.entity_id = auth.uid()::text
  order by l.created_at desc
  limit 50;
$$;

grant execute on function public.my_personal_finance_reads() to authenticated;

-- Cria conta e categorias pessoais padrão para o usuário atual (idempotente).
create or replace function public.ensure_personal_defaults()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if not private.has_perm('finance.personal.manage') then
    return;
  end if;
  if not exists (select 1 from public.financial_accounts where scope = 'pessoal' and owner_user_id = v_me) then
    insert into public.financial_accounts (scope, owner_user_id, name, type) values ('pessoal', v_me, 'Conta pessoal', 'corrente');
  end if;
  if not exists (select 1 from public.financial_categories where scope = 'pessoal' and owner_user_id = v_me) then
    insert into public.financial_categories (scope, owner_user_id, name, kind)
    select 'pessoal', v_me, n, k::public.txn_kind from (values
      ('Salário / pró-labore', 'receita'), ('Outras receitas', 'receita'),
      ('Moradia', 'despesa'), ('Alimentação', 'despesa'), ('Transporte', 'despesa'), ('Saúde', 'despesa'),
      ('Educação', 'despesa'), ('Lazer', 'despesa'), ('Contas da casa', 'despesa'), ('Outras despesas', 'despesa')
    ) as x(n, k);
  end if;
end;
$$;

grant execute on function public.ensure_personal_defaults() to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.financial_accounts enable row level security;
alter table public.financial_categories enable row level security;
alter table public.cost_centers enable row level security;
alter table public.financial_recurrences enable row level security;
alter table public.financial_transactions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['financial_accounts', 'financial_categories', 'financial_recurrences'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using (organization_id = (select private.org_id()) and private.fin_can(scope, owner_user_id, 'read'));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check (organization_id = (select private.org_id())
                    and (scope = 'empresa' or owner_user_id = (select auth.uid()))
                    and private.fin_can(scope, owner_user_id, 'create'));
      create policy %1$s_update on public.%1$s for update to authenticated
        using (organization_id = (select private.org_id()) and private.fin_can(scope, owner_user_id, 'update'))
        with check (organization_id = (select private.org_id()) and private.fin_can(scope, owner_user_id, 'update'));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using (organization_id = (select private.org_id()) and private.fin_can(scope, owner_user_id, 'delete'));
    $f$, t);
  end loop;
end $$;

create policy cost_centers_select on public.cost_centers for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('finance.company.read')));
create policy cost_centers_write on public.cost_centers for all to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('finance.company.update')))
  with check (organization_id = (select private.org_id()) and (select private.has_perm('finance.company.update')));

create policy fin_txn_select on public.financial_transactions for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is null and private.fin_can(scope, owner_user_id, 'read'));
create policy fin_txn_insert on public.financial_transactions for insert to authenticated
  with check (organization_id = (select private.org_id())
              and (scope = 'empresa' or owner_user_id = (select auth.uid()))
              and private.fin_can(scope, owner_user_id, 'create'));
-- Atualizar: editar, conciliar ou excluir (exclusão lógica); o trigger valida cada caso.
create policy fin_txn_update on public.financial_transactions for update to authenticated
  using (organization_id = (select private.org_id())
         and (private.fin_can(scope, owner_user_id, 'update') or private.fin_can(scope, owner_user_id, 'reconcile')
              or private.fin_can(scope, owner_user_id, 'delete')))
  with check (organization_id = (select private.org_id()));

-- -----------------------------------------------------------------------------
-- Padrões da empresa
-- -----------------------------------------------------------------------------
insert into public.financial_accounts (organization_id, scope, name, type)
select id, 'empresa', 'Conta principal', 'corrente' from public.organizations;

insert into public.financial_categories (organization_id, scope, name, kind)
select o.id, 'empresa', c.name, c.kind::public.txn_kind
from public.organizations o
cross join (values
  ('Venda de sites', 'receita'), ('Manutenção de sites', 'receita'), ('Gestão de tráfego', 'receita'), ('Outras receitas', 'receita'),
  ('Ferramentas e software', 'despesa'), ('Hospedagem e domínios', 'despesa'), ('Verba de anúncios', 'despesa'),
  ('Impostos', 'despesa'), ('Pró-labore', 'despesa'), ('Marketing', 'despesa'), ('Terceirizados', 'despesa'), ('Outras despesas', 'despesa')
) as c(name, kind);

insert into public.cost_centers (organization_id, name)
select o.id, c.name from public.organizations o cross join (values ('Comercial'), ('Produção'), ('Administrativo')) as c(name);

insert into supabase_migrations.schema_migrations (version, name) values ('20261031000600', 'finance') on conflict do nothing;

-- ===== supabase/migrations/20261031000700_dashboards_google.sql
-- =============================================================================
-- Fase 6 · Indicadores comerciais e integração com o Google Calendar
-- =============================================================================

-- Indicadores comerciais do período. SECURITY INVOKER: a RLS limita os números
-- ao que o usuário pode ver (vendedor vê os próprios; gestor vê todos).
create or replace function public.commercial_dashboard(p_from date, p_to date, p_owner uuid default null, p_pipeline uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with
  bounds as (
    select (p_from::timestamp at time zone 'America/Sao_Paulo') as t0,
           ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo') as t1
  ),
  pipe as (
    select coalesce(p_pipeline, (select id from public.pipelines where is_active order by position limit 1)) as id
  ),
  d as (
    select d.* from public.deals d, pipe
    where d.deleted_at is null and d.pipeline_id = pipe.id and (p_owner is null or d.owner_id = p_owner)
  ),
  hist as (
    select h.*, s.name as stage_name, s.kind from public.deal_stage_history h
    join d on d.id = h.deal_id
    join public.stages s on s.id = h.to_stage_id, bounds
    where h.moved_at >= bounds.t0 and h.moved_at < bounds.t1
  ),
  won as (select * from d, bounds where d.won_at >= bounds.t0 and d.won_at < bounds.t1),
  lost as (select * from d, bounds where d.lost_at >= bounds.t0 and d.lost_at < bounds.t1),
  k as (
    select k.*, s.name as service_name from public.contracts k
    left join public.services s on s.id = k.service_id
    where k.deleted_at is null and k.status <> 'cancelado' and (p_owner is null or k.owner_id = p_owner)
  ),
  kp as (select * from k where k.start_date between p_from and p_to),
  leads_in as (
    select l.* from public.leads l, bounds
    where l.deleted_at is null and (p_owner is null or l.owner_id = p_owner)
  )
  select jsonb_build_object(
    'total_leads', (select count(*) from leads_in),
    'new_leads', (select count(*) from leads_in, bounds where leads_in.created_at >= bounds.t0 and leads_in.created_at < bounds.t1),
    'by_stage', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'count', (select count(*) from d where d.stage_id = s.id),
                                          'amount', (select coalesce(sum(d.amount_cents), 0) from d where d.stage_id = s.id)) order by s.position)
      from public.stages s, pipe where s.pipeline_id = pipe.id), '[]'::jsonb),
    'by_owner', coalesce((
      select jsonb_agg(x order by (x ->> 'count')::int desc) from (
        select jsonb_build_object('owner_id', d.owner_id, 'name', coalesce(p.full_name, 'Sem responsável'), 'count', count(*),
                                  'won', count(*) filter (where d.won_at is not null)) as x
        from d left join public.profiles p on p.id = d.owner_id
        group by d.owner_id, p.full_name
      ) t), '[]'::jsonb),
    'meetings', (select count(*) from public.calendar_events e, bounds
                 where e.deleted_at is null and e.kind = 'reuniao' and e.starts_at >= bounds.t0 and e.starts_at < bounds.t1
                   and (p_owner is null or e.owner_id = p_owner)),
    'meetings_stage', (select count(distinct deal_id) from hist where stage_name ilike 'reuni%'),
    'proposals', (select count(distinct deal_id) from hist where stage_name ilike 'proposta%'),
    'won', (select count(*) from won),
    'lost', (select count(*) from lost),
    'lost_reasons', coalesce((
      select jsonb_agg(jsonb_build_object('name', coalesce(r.name, 'Sem motivo'), 'count', c) order by c desc)
      from (select lost_reason_id, count(*) c from lost group by lost_reason_id) x
      left join public.lost_reasons r on r.id = x.lost_reason_id), '[]'::jsonb),
    'revenue', (select coalesce(sum(amount_cents), 0) from kp),
    'contracts', (select count(*) from kp),
    'mrr', (select coalesce(sum(case recurrence when 'mensal' then amount_cents when 'trimestral' then amount_cents / 3
                                                 when 'semestral' then amount_cents / 6 when 'anual' then amount_cents / 12 else 0 end), 0)
            from k where status = 'ativo'),
    'by_month', coalesce((
      select jsonb_agg(jsonb_build_object('month', m, 'amount', amount, 'count', cnt) order by m)
      from (select to_char(start_date, 'YYYY-MM') m, sum(amount_cents) amount, count(*) cnt
            from k where start_date >= (p_to - interval '11 months')::date and start_date <= p_to group by 1) x), '[]'::jsonb),
    'by_service', coalesce((
      select jsonb_agg(jsonb_build_object('name', coalesce(service_name, 'Outros'), 'amount', amount, 'count', cnt) order by amount desc)
      from (select service_name, sum(amount_cents) amount, count(*) cnt from kp group by service_name) x), '[]'::jsonb),
    'pipeline_open_amount', (select coalesce(sum(d.amount_cents), 0) from d join public.stages s on s.id = d.stage_id where s.kind = 'open'),
    'forecast', coalesce((
      select jsonb_agg(jsonb_build_object('month', m, 'amount', amount) order by m)
      from (select to_char(expected_close_date, 'YYYY-MM') m, sum(d.amount_cents) amount
            from d join public.stages s on s.id = d.stage_id
            where s.kind = 'open' and d.expected_close_date is not null and d.amount_cents is not null
              and d.expected_close_date between (now() at time zone 'America/Sao_Paulo')::date and ((now() at time zone 'America/Sao_Paulo')::date + 90)
            group by 1) x), '[]'::jsonb),
    'overdue_tasks', (select count(*) from public.tasks t where t.deleted_at is null and t.status in ('a_fazer', 'em_andamento')
                        and t.due_at < now() and (p_owner is null or t.owner_id = p_owner)),
    'overdue_contacts', (select count(*) from leads_in where next_contact_at < now())
  );
$$;

grant execute on function public.commercial_dashboard(date, date, uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Google Calendar
-- Tokens ficam cifrados (AES-GCM no servidor) e esta tabela não tem políticas:
-- só o servidor, com a chave secreta, lê ou grava. O navegador nunca vê tokens.
-- -----------------------------------------------------------------------------
create table public.google_calendar_connections (
  user_id            uuid primary key references public.profiles (id) on delete cascade,
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  google_email       text not null,
  calendar_id        text not null default 'primary',
  refresh_token_enc  text not null,
  access_token_enc   text,
  access_expires_at  timestamptz,
  sync_token         text,
  status             text not null default 'ativa' check (status in ('ativa', 'erro', 'revogada')),
  last_synced_at     timestamptz,
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.google_calendar_connections enable row level security;
revoke all on public.google_calendar_connections from authenticated, anon;

alter table public.calendar_events add column source text not null default 'interno' check (source in ('interno', 'google'));
alter table public.calendar_events add column google_event_id text;
alter table public.calendar_events add column google_etag text;
alter table public.calendar_events add column google_synced_at timestamptz;
create unique index calendar_events_google_uq on public.calendar_events (owner_id, google_event_id) where google_event_id is not null;

-- Estado da conexão sem expor tokens.
create or replace function public.my_google_connection()
returns table (google_email text, status text, last_synced_at timestamptz, last_error text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.google_email, c.status, c.last_synced_at, c.last_error
  from public.google_calendar_connections c
  where c.user_id = auth.uid();
$$;

grant execute on function public.my_google_connection() to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261031000700', 'dashboards_google') on conflict do nothing;

-- ===== supabase/migrations/20261031000800_lgpd.sql
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

insert into supabase_migrations.schema_migrations (version, name) values ('20261031000800', 'lgpd') on conflict do nothing;

-- ===== supabase/migrations/20261031050522_restrict_public_rpc_execution.sql
-- Funções SECURITY DEFINER devem ser executadas apenas por usuários autenticados.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon', fn.signature);
  end loop;
end;
$$;

alter default privileges in schema public revoke execute on functions from public, anon;

insert into supabase_migrations.schema_migrations (version, name) values ('20261031050522', 'restrict_public_rpc_execution') on conflict do nothing;

commit;
