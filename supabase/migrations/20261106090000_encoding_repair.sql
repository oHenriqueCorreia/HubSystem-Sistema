-- =============================================================================
-- Acentuação corrompida (UTF-8 lido como Windows-1252)
-- =============================================================================
-- Causa: na instalação inicial três funções foram gravadas com o texto
-- corrompido. A correção anterior (fix_encoding) só cobria a faixa Latin-1 e não
-- pegou aspas tipográficas e letras do Windows-1252 (“ ” – … š €):
--   * deals_after   → linha do tempo "Movido de â€œ…â€ para …"
--   * import_leads  → linha do tempo "Importado de â€œ…â€"
--   * seed_cadences → "Ãšltima tentativa" nas cadências de empresas novas
-- Aqui:
--   1. As três funções voltam ao texto correto do repositório (novos registros saem certos).
--   2. private.fix_mojibake_1252: a mesma regra de src/domain/shared/encoding.ts.
--   3. Reparo dos registros antigos SOB DEMANDA, por um administrador, em
--      Configurações → Manutenção: pré-visualização, confirmação, cópia de
--      segurança de cada valor e "desfazer". Nada é alterado por esta migration.
-- =============================================================================

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

-- Byte que o caractere representava no Windows-1252 / Latin-1 (null se nenhum).
create or replace function private.cp1252_byte(p_code int)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when p_code <= 255 then p_code else (
    select m.b from (values (8364, 128), (8218, 130), (402, 131), (8222, 132), (8230, 133), (8224, 134), (8225, 135), (710, 136), (8240, 137),
      (352, 138), (8249, 139), (338, 140), (381, 142), (8216, 145), (8217, 146), (8220, 147), (8221, 148), (8226, 149), (8211, 150),
      (8212, 151), (732, 152), (8482, 153), (353, 154), (8250, 155), (339, 156), (382, 158), (376, 159)) as m(cp, b)
    where m.cp = p_code) end;
$$;

-- Caractere de continuação: o que um byte 0x80–0xBF vira no Windows-1252/Latin-1.
create or replace function private.mojibake_1252_cont()
returns text
language sql
immutable
set search_path = ''
as $$
  select '[' || chr(128) || '-' || chr(191) || chr(338) || chr(339) || chr(352) || chr(353) || chr(376) || chr(381) || chr(382) || chr(402)
    || chr(710) || chr(732) || chr(8211) || chr(8212) || chr(8216) || chr(8217) || chr(8218) || chr(8220) || chr(8221) || chr(8222)
    || chr(8224) || chr(8225) || chr(8226) || chr(8230) || chr(8240) || chr(8249) || chr(8250) || chr(8364) || chr(8482) || ']';
$$;

-- Sequência UTF-8 completa lida como Windows-1252: 1º byte + 1, 2 ou 3 continuações.
create or replace function private.mojibake_1252_pattern()
returns text
language sql
immutable
set search_path = ''
as $$
  select '[' || chr(194) || '-' || chr(223) || ']' || c || '|[' || chr(224) || '-' || chr(239) || ']' || c || '{2}|['
      || chr(240) || '-' || chr(244) || ']' || c || '{3}'
  from (select private.mojibake_1252_cont() as c) x;
$$;

-- Desfaz "â€œ" → "“", "Ã§" → "ç". Só troca o que forma UTF-8 válido; texto correto não muda.
create or replace function private.fix_mojibake_1252(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_re text := private.mojibake_1252_pattern();
  m text[];
  v_out text := p;
  v_bytes bytea;
  v_b int;
  v_ok boolean;
  i int;
begin
  if p is null or p !~ v_re then
    return p;
  end if;
  for m in select regexp_matches(p, '(' || v_re || ')', 'g') loop
    v_bytes := ''::bytea;
    v_ok := true;
    for i in 1 .. char_length(m[1]) loop
      v_b := private.cp1252_byte(ascii(substr(m[1], i, 1)));
      if v_b is null then
        v_ok := false;
        exit;
      end if;
      v_bytes := v_bytes || set_byte('\x00'::bytea, 0, v_b);
    end loop;
    if v_ok then
      begin
        v_out := replace(v_out, m[1], convert_from(v_bytes, 'UTF8'));
      exception when others then
        null;
      end;
    end if;
  end loop;
  return v_out;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reparo sob demanda, com cópia de segurança e "desfazer"
-- -----------------------------------------------------------------------------
create table private.encoding_fix_batches (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  rows_fixed       int not null default 0,
  reverted_at      timestamptz,
  reverted_by      uuid references auth.users (id) on delete set null
);

create table private.encoding_fix_rows (
  batch_id     uuid not null references private.encoding_fix_batches (id) on delete cascade,
  table_name   text not null,
  column_name  text not null,
  row_id       text not null,
  before       text not null,
  after        text not null,
  primary key (batch_id, table_name, column_name, row_id)
);

-- Colunas de texto que a pessoa lê, em tabelas com "id" e "organization_id".
-- Fora: segredos, identificadores externos, endereços, telefones e chaves.
create or replace function private.encoding_fix_columns()
returns table (table_name text, column_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.table_name::text, c.column_name::text
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
  where c.table_schema = 'public' and c.data_type in ('text', 'character varying')
    and c.column_name !~ '(_enc$|hash|token|secret|url|e164|^id$|_id$|wamid|jid|^key$|signature|etag|endpoint|p256dh|^auth$|path|mime|^email$|_email$|^document$|^status$|^kind$|^provider$)'
    and exists (select 1 from information_schema.columns x where x.table_schema = 'public' and x.table_name = c.table_name and x.column_name = 'id')
    and exists (select 1 from information_schema.columns x where x.table_schema = 'public' and x.table_name = c.table_name and x.column_name = 'organization_id')
    and c.table_name not in ('audit_logs', 'permissions');
$$;

/** Textos que mudariam (sem alterar nada). Só administrador com admin.settings. */
create or replace function public.admin_encoding_preview(p_limit int default 500)
returns table (table_name text, column_name text, row_id text, before text, after text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c record;
  v_re text := private.mojibake_1252_pattern();
  v_left int := least(greatest(coalesce(p_limit, 500), 1), 5000);
  i int;
begin
  if not private.has_perm('admin.settings') then
    raise exception 'Você não tem permissão para a manutenção do sistema.' using errcode = '42501';
  end if;
  for c in select * from private.encoding_fix_columns() order by 1, 2 loop
    exit when v_left <= 0;
    return query execute format(
      'select %L::text, %L::text, t.id::text, t.%I::text, private.fix_mojibake_1252(t.%I::text)
         from public.%I t
        where t.organization_id = $1 and t.%I ~ $2 and private.fix_mojibake_1252(t.%I::text) is distinct from t.%I::text
        order by t.id limit $3',
      c.table_name, c.column_name, c.column_name, c.column_name, c.table_name, c.column_name, c.column_name, c.column_name)
      using private.org_id(), v_re, v_left;
    get diagnostics i = row_count;
    v_left := v_left - i;
  end loop;
end;
$$;

/** Aplica o reparo com cópia de cada valor. Exige digitar CORRIGIR. Devolve o lote (para desfazer). */
create or replace function public.admin_encoding_apply(p_confirm text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  v_batch uuid;
  v_org uuid := private.org_id();
  v_re text := private.mojibake_1252_pattern();
  v_count int := 0;
  n int;
begin
  if not private.has_perm('admin.settings') then
    raise exception 'Você não tem permissão para a manutenção do sistema.' using errcode = '42501';
  end if;
  if p_confirm is distinct from 'CORRIGIR' then
    raise exception 'Confirme digitando CORRIGIR.' using errcode = 'P0001', hint = 'confirm';
  end if;
  insert into private.encoding_fix_batches (organization_id, created_by) values (v_org, auth.uid()) returning id into v_batch;
  perform set_config('hub.trusted_op', 'on', true);
  for c in select * from private.encoding_fix_columns() loop
    -- Cópia antes de alterar; a alteração só vale se o texto ainda for o copiado.
    execute format(
      'insert into private.encoding_fix_rows (batch_id, table_name, column_name, row_id, before, after)
       select $1, %L, %L, t.id::text, t.%I::text, private.fix_mojibake_1252(t.%I::text)
         from public.%I t
        where t.organization_id = $2 and t.%I ~ $3 and private.fix_mojibake_1252(t.%I::text) is distinct from t.%I::text',
      c.table_name, c.column_name, c.column_name, c.column_name, c.table_name, c.column_name, c.column_name, c.column_name)
      using v_batch, v_org, v_re;
    execute format(
      'update public.%I t set %I = r.after
         from private.encoding_fix_rows r
        where r.batch_id = $1 and r.table_name = %L and r.column_name = %L and t.id::text = r.row_id and t.%I::text = r.before',
      c.table_name, c.column_name, c.table_name, c.column_name, c.column_name)
      using v_batch;
    get diagnostics n = row_count;
    v_count := v_count + n;
  end loop;
  perform set_config('hub.trusted_op', 'off', true);
  update private.encoding_fix_batches set rows_fixed = v_count where id = v_batch;
  perform private.log_event('encoding_fix', 'maintenance', v_batch::text, jsonb_build_object('textos', v_count));
  return v_batch;
end;
$$;

/** Desfaz um lote: volta o texto anterior onde ele ainda não foi editado de novo. */
create or replace function public.admin_encoding_revert(p_batch uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  v_count int := 0;
  n int;
begin
  if not private.has_perm('admin.settings') then
    raise exception 'Você não tem permissão para a manutenção do sistema.' using errcode = '42501';
  end if;
  if not exists (select 1 from private.encoding_fix_batches where id = p_batch and organization_id = private.org_id() and reverted_at is null) then
    raise exception 'Correção não encontrada ou já desfeita.' using errcode = 'P0002';
  end if;
  perform set_config('hub.trusted_op', 'on', true);
  for c in select distinct r.table_name, r.column_name from private.encoding_fix_rows r where r.batch_id = p_batch loop
    execute format(
      'update public.%I t set %I = r.before
         from private.encoding_fix_rows r
        where r.batch_id = $1 and r.table_name = %L and r.column_name = %L and t.id::text = r.row_id and t.%I::text = r.after',
      c.table_name, c.column_name, c.table_name, c.column_name, c.column_name)
      using p_batch;
    get diagnostics n = row_count;
    v_count := v_count + n;
  end loop;
  perform set_config('hub.trusted_op', 'off', true);
  update private.encoding_fix_batches set reverted_at = now(), reverted_by = auth.uid() where id = p_batch;
  perform private.log_event('encoding_revert', 'maintenance', p_batch::text, jsonb_build_object('textos', v_count));
  return v_count;
end;
$$;

/** Correções já feitas na empresa (para desfazer). */
create or replace function public.admin_encoding_batches()
returns table (id uuid, created_at timestamptz, created_by_name text, rows_fixed int, reverted_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.created_at, coalesce(nullif(p.full_name, ''), p.email), b.rows_fixed, b.reverted_at
  from private.encoding_fix_batches b
  left join public.profiles p on p.id = b.created_by
  where b.organization_id = private.org_id() and private.has_perm('admin.settings')
  order by b.created_at desc
  limit 20;
$$;

revoke execute on function public.admin_encoding_preview(int), public.admin_encoding_apply(text), public.admin_encoding_revert(uuid),
  public.admin_encoding_batches() from public, anon;
grant execute on function public.admin_encoding_preview(int), public.admin_encoding_apply(text), public.admin_encoding_revert(uuid),
  public.admin_encoding_batches() to authenticated;
