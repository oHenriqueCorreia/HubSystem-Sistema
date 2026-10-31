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
