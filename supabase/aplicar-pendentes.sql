-- HubSystem · migrations pendentes (20261102110000 em diante) em um único script.
-- Como usar: Supabase → SQL Editor → New query → cole TODO este arquivo → Run.
-- Tudo roda numa transação: se algo falhar, nada é aplicado. Rode uma única vez.
-- Gerado a partir de supabase/migrations/. Não edite à mão.

begin;

-- ===== supabase/migrations/20261102110000_fix_encoding.sql
-- =============================================================================
-- Correção de acentuação (UTF-8 gravado como Latin-1 na instalação inicial)
-- =============================================================================
-- Sintoma: "SaÃºde", "AlimentaÃ§Ã£o", "ImportaÃ§Ã£o" em categorias, etapas,
-- serviços, modelos, origem de leads e em mensagens/padrões de funções.
--   * private.fix_mojibake troca só as sequências corrompidas (ex.: "Ã§" → "ç"),
--     preservando o resto do texto. Texto já correto não muda.
--   * Corrige todas as colunas de texto das tabelas de public e recria, com o
--     texto corrigido, as funções de public/private que tinham o problema
--     (CREATE OR REPLACE mantém permissões, gatilhos e dono).
-- Idempotente: rodar de novo não altera nada.
-- =============================================================================

-- Sequência corrompida: byte inicial de UTF-8 (U+00C2..U+00F4) seguido de 1 a 3 bytes de continuação (U+0080..U+00BF).
create or replace function private.mojibake_pattern()
returns text
language sql
immutable
set search_path = ''
as $$
  select '[' || chr(194) || '-' || chr(244) || '][' || chr(128) || '-' || chr(191) || ']';
$$;

create or replace function private.fix_mojibake(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  m text[];
  v_out text := p;
begin
  if p is null or p !~ private.mojibake_pattern() then
    return p;
  end if;
  for m in select regexp_matches(p, private.mojibake_pattern() || '{1,3}', 'g') loop
    begin
      v_out := replace(v_out, m[1], convert_from(convert_to(m[1], 'LATIN1'), 'UTF8'));
    exception when others then
      null; -- não é UTF-8 válido: mantém como está
    end;
  end loop;
  return v_out;
end;
$$;

do $fix$
declare
  r record;
begin
  -- 1) Dados: toda coluna de texto das tabelas de public.
  perform set_config('hub.trusted_op', 'on', true);
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
       and c.data_type in ('text', 'character varying')
  loop
    execute format('update public.%I set %I = private.fix_mojibake(%I) where %I ~ private.mojibake_pattern()',
                   r.table_name, r.column_name, r.column_name, r.column_name);
  end loop;
  perform set_config('hub.trusted_op', 'off', true);

  -- 2) Funções: recria com o texto corrigido (mensagens de erro e padrões de novas organizações).
  for r in
    select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.prokind = 'f'
       and p.proname not in ('fix_mojibake', 'mojibake_pattern')
       and p.prosrc ~ private.mojibake_pattern()
  loop
    execute private.fix_mojibake(pg_get_functiondef(r.oid));
  end loop;
end;
$fix$;

insert into supabase_migrations.schema_migrations (version, name) values ('20261102110000', 'fix_encoding') on conflict do nothing;

commit;
