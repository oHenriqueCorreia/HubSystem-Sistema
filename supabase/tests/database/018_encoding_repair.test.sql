begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- Aspas corrompidas: “ = â € œ ; ” = â € (U+009D, invisível).
create or replace function pg_temp.q() returns text language sql as $$ select chr(226) || chr(8364) || chr(339) $$;
create or replace function pg_temp.qq() returns text language sql as $$ select chr(226) || chr(8364) || chr(157) $$;

select is(private.fix_mojibake_1252('Importado de ' || pg_temp.q() || 'lista.csv' || pg_temp.qq()), 'Importado de “lista.csv”', 'conserta aspas tipográficas');
select is(private.fix_mojibake_1252('Ã' || chr(353) || 'ltima tentativa'), 'Última tentativa', 'conserta letra do Windows-1252 (š)');
select is(private.fix_mojibake_1252('Vidra' || chr(195) || chr(167) || 'aria S' || chr(195) || chr(163) || 'o Jos' || chr(195) || chr(169)), 'Vidraçaria São José', 'conserta cedilha e acentos');
select is(private.fix_mojibake_1252('SÃO PAULO, NÃO, 1º lugar, Ação, “aspas”'), 'SÃO PAULO, NÃO, 1º lugar, Ação, “aspas”', 'não mexe em texto correto');
select ok((select prosrc like '%Importado de “%' from pg_proc where proname = 'import_leads'), 'importação volta a gravar as aspas certas');
select ok((select prosrc like '%Movido de “%' from pg_proc where proname = 'deals_after'), 'histórico do funil volta a gravar as aspas certas');

-- Duas empresas; a A tem um texto corrompido e um correto.
insert into public.organizations (id, name) values ('e8000000-0000-4000-8000-00000000000a', 'Acentos A'), ('e8000000-0000-4000-8000-00000000000b', 'Acentos B');
create or replace function pg_temp.mk_user(p_id uuid, p_org uuid, p_email text, p_role_key text)
returns void language plpgsql as $$
declare
  v_inv uuid := gen_random_uuid();
begin
  insert into public.invitations (id, organization_id, email, mode, role_id, token_hash)
  values (v_inv, p_org, p_email, 'equipe', (select id from public.roles where organization_id = p_org and key = p_role_key), 'hash-' || v_inv);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, jsonb_build_object('invitation_id', v_inv), now(), now());
  update public.invitations set user_id = p_id where id = v_inv;
  perform public.finalize_invitation(v_inv, split_part(p_email, '@', 1));
end;
$$;
select pg_temp.mk_user('e8000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-00000000000a', 'adm@acentos.t', 'admin');
select pg_temp.mk_user('e8000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-00000000000a', 'col@acentos.t', 'colaborador');
select pg_temp.mk_user('e8000000-0000-4000-8000-000000000003', 'e8000000-0000-4000-8000-00000000000b', 'adm@outra.t', 'admin');

insert into public.leads (id, organization_id, name) values
  ('e8000000-0000-4000-8000-0000000000a1', 'e8000000-0000-4000-8000-00000000000a', 'Lead A'),
  ('e8000000-0000-4000-8000-0000000000b1', 'e8000000-0000-4000-8000-00000000000b', 'Lead B');
insert into public.activities (id, organization_id, lead_id, type, content) values
  ('e8000000-0000-4000-8000-0000000000c1', 'e8000000-0000-4000-8000-00000000000a', 'e8000000-0000-4000-8000-0000000000a1', 'sistema', 'Importado de ' || pg_temp.q() || 'nicho.csv' || pg_temp.qq()),
  ('e8000000-0000-4000-8000-0000000000c2', 'e8000000-0000-4000-8000-00000000000a', 'e8000000-0000-4000-8000-0000000000a1', 'nota', 'SÃO PAULO e Ação, tudo certo'),
  ('e8000000-0000-4000-8000-0000000000c3', 'e8000000-0000-4000-8000-00000000000a', 'e8000000-0000-4000-8000-0000000000a1', 'sistema', 'Movido de ' || pg_temp.q() || 'Contato' || pg_temp.qq()),
  ('e8000000-0000-4000-8000-0000000000c9', 'e8000000-0000-4000-8000-00000000000b', 'e8000000-0000-4000-8000-0000000000b1', 'sistema', 'Importado de ' || pg_temp.q() || 'outra.csv' || pg_temp.qq());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e8000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select * from public.admin_encoding_preview() $$, '42501', null, 'colaborador não vê a manutenção');

select set_config('request.jwt.claims', '{"sub":"e8000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.admin_encoding_preview() where table_name = 'activities'), 2, 'pré-visualização mostra só os textos corrompidos da própria empresa');
select is((select after from public.admin_encoding_preview() where row_id = 'e8000000-0000-4000-8000-0000000000c1'), 'Importado de “nicho.csv”', 'pré-visualização mostra o texto corrigido');
select is((select content from public.activities where id = 'e8000000-0000-4000-8000-0000000000c1'), 'Importado de ' || pg_temp.q() || 'nicho.csv' || pg_temp.qq(), 'pré-visualização não altera nada');
select throws_ok($$ select public.admin_encoding_apply('sim') $$, 'P0001', null, 'aplicar exige digitar CORRIGIR');

select set_config('test.lote', public.admin_encoding_apply('CORRIGIR')::text, true);
select is((select array_agg(content order by id) from public.activities where lead_id = 'e8000000-0000-4000-8000-0000000000a1'),
  array['Importado de “nicho.csv”', 'SÃO PAULO e Ação, tudo certo', 'Movido de “Contato”'], 'corrige os textos e mantém o correto');

-- Depois da correção, alguém edita um dos textos; desfazer não atropela essa edição.
reset role;
update public.activities set content = 'Editado depois' where id = 'e8000000-0000-4000-8000-0000000000c3';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e8000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.admin_encoding_revert(current_setting('test.lote')::uuid), 1, 'desfazer volta só o que não foi editado depois');
select is((select content from public.activities where id = 'e8000000-0000-4000-8000-0000000000c1'), 'Importado de ' || pg_temp.q() || 'nicho.csv' || pg_temp.qq(), 'texto volta ao original copiado');
select is((select content from public.activities where id = 'e8000000-0000-4000-8000-0000000000c3'), 'Editado depois', 'edição posterior é preservada');
select throws_ok(format($$ select public.admin_encoding_revert(%L::uuid) $$, current_setting('test.lote')), 'P0002', null, 'o mesmo lote não é desfeito duas vezes');

reset role;
select is((select content from public.activities where id = 'e8000000-0000-4000-8000-0000000000c9'), 'Importado de ' || pg_temp.q() || 'outra.csv' || pg_temp.qq(), 'outra empresa não é tocada');

select * from finish();
rollback;
